"""Fail-closed Keycloak account and direct-group checks for every authorization."""

import re
import secrets
import ssl
import time
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, select, update

from .db import audit
from .models import APIKey, DeviceClient, DeviceGrant, Session, User


@dataclass(frozen=True)
class IdentityStatus:
    enabled: bool
    groups: frozenset[str]
    keycloak_access: bool | None = None


def lifecycle_configured(settings) -> bool:
    try:
        issuer = urlsplit(settings.oidc_issuer.rstrip("/"))
        verifier = urlsplit(settings.oidc_upstream_verifier_url)
        # Accessing .port validates numeric range and syntax.
        issuer.port
        verifier.port
        realm = re.fullmatch(r"(.*)/realms/([A-Za-z0-9_-][A-Za-z0-9._-]*)", issuer.path)
        return bool(
            settings.oidc_lifecycle_sync_confirmed
            and settings.oidc_lifecycle_client_id
            and settings.oidc_lifecycle_client_secret.get_secret_value()
            and settings.oidc_access_group_id
            and settings.oidc_admin_group_id
            and settings.oidc_reviewer_group_id
            and issuer.scheme == "https"
            and issuer.hostname
            and not issuer.username
            and not issuer.password
            and not issuer.query
            and not issuer.fragment
            and realm
            and realm.group(2) not in {".", ".."}
            and verifier.scheme == "https"
            and verifier.hostname
            and not verifier.username
            and not verifier.password
            and not verifier.query
            and not verifier.fragment
            and settings.oidc_upstream_verifier_secret.get_secret_value()
        )
    except ValueError:
        return False


def tls_verify(settings):
    if settings.oidc_lifecycle_ca_bundle:
        return ssl.create_default_context(cafile=settings.oidc_lifecycle_ca_bundle)
    return True


def keycloak_status(settings, subject: str) -> IdentityStatus:
    """Read an exact realm user and all direct groups; never use token claims as status."""
    issuer = settings.oidc_issuer.rstrip("/")
    parsed = urlsplit(issuer)
    match = re.fullmatch(r"(.*)/realms/([A-Za-z0-9_-][A-Za-z0-9._-]*)", parsed.path)
    if (
        not settings.oidc_lifecycle_sync_confirmed
        or not settings.oidc_lifecycle_client_id
        or not settings.oidc_lifecycle_client_secret.get_secret_value()
        or not settings.oidc_access_group_id
        or not settings.oidc_admin_group_id
        or not settings.oidc_reviewer_group_id
        or parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not match
        or match.group(2) in {".", ".."}
        or not subject
        or subject in {".", ".."}
        or "/" in subject
        or "\\" in subject
    ):
        raise HTTPException(503, "Identity lifecycle verification unavailable")
    root = f"{parsed.scheme}://{parsed.netloc}{match.group(1)}"
    user_url = f"{root}/admin/realms/{match.group(2)}/users/{quote(subject, safe='')}"
    try:
        with httpx.Client(
            timeout=5, follow_redirects=False, trust_env=False, verify=tls_verify(settings)
        ) as client:
            response = client.post(
                issuer + "/protocol/openid-connect/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": settings.oidc_lifecycle_client_id,
                    "client_secret": settings.oidc_lifecycle_client_secret.get_secret_value(),
                },
            )
            response.raise_for_status()
            payload = response.json()
            token = payload.get("access_token") if isinstance(payload, dict) else None
            if not isinstance(token, str) or not token:
                raise ValueError("Missing service token")
            headers = {"Authorization": "Bearer " + token}
            response = client.get(user_url, headers=headers)
            if response.status_code == 404:
                # A gateway may return 404 too; require an explicit upstream denial
                # before treating this as an irreversible account revocation.
                upstream = upstream_status(settings, subject)
                if (
                    not upstream.enabled
                    or not upstream.keycloak_access
                    or settings.oidc_access_group_id not in upstream.groups
                ):
                    return IdentityStatus(False, frozenset())
                raise ValueError("Keycloak user lookup unavailable")
            response.raise_for_status()
            user = response.json()
            if (
                not isinstance(user, dict)
                or user.get("id") != subject
                or type(user.get("enabled")) is not bool
            ):
                raise ValueError("Invalid user response")
            if not user["enabled"]:
                return IdentityStatus(False, frozenset())
            groups: set[str] = set()
            first = 0
            for _ in range(100):
                response = client.get(
                    user_url + "/groups", headers=headers, params={"first": first, "max": 100}
                )
                response.raise_for_status()
                members = response.json()
                if not isinstance(members, list) or len(members) > 100:
                    raise ValueError("Invalid group response")
                if not members:
                    return IdentityStatus(True, frozenset(groups))
                for group in members:
                    if (
                        not isinstance(group, dict)
                        or not isinstance(group.get("id"), str)
                        or not group["id"]
                        or group["id"] in groups
                    ):
                        raise ValueError("Invalid group response")
                    groups.add(group["id"])
                first += len(members)
            raise ValueError("Group pagination limit exceeded")
    except (httpx.HTTPError, httpx.InvalidURL, ValueError, TypeError, KeyError, OSError):
        # Provider payloads, credentials, and response bodies must never enter logs or responses.
        raise HTTPException(503, "Identity lifecycle verification unavailable") from None


def revoke_identity_credentials(db, user_id: str) -> None:
    """Permanently invalidate credentials and outstanding grants after an authoritative denial."""
    now = time.time()
    with db.session.begin() as s:
        clients = select(DeviceClient.id).where(DeviceClient.owner_id == user_id)
        keys = s.execute(
            update(APIKey)
            .where(APIKey.owner_id == user_id, APIKey.revoked_at.is_(None))
            .values(revoked_at=now)
        ).rowcount
        sessions = s.execute(delete(Session).where(Session.user_id == user_id)).rowcount
        grants = s.execute(
            update(DeviceGrant)
            .where(
                (DeviceGrant.user_id == user_id) | DeviceGrant.client_id.in_(clients),
                DeviceGrant.status.in_(["pending", "approved"]),
            )
            .values(status="denied")
        ).rowcount
        disabled = s.execute(
            update(DeviceClient)
            .where(DeviceClient.owner_id == user_id, DeviceClient.active.is_(True))
            .values(active=False)
        ).rowcount
        if keys or sessions or grants or disabled:
            audit(s, None, "identity.credentials_revoked", user_id)


def upstream_status(settings, subject: str) -> IdentityStatus:
    """Require a fresh, per-request result from the operator's authoritative verifier."""
    url = settings.oidc_upstream_verifier_url
    parsed = urlsplit(url)
    secret = settings.oidc_upstream_verifier_secret.get_secret_value()
    if (
        not url
        or parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not secret
    ):
        raise HTTPException(503, "Identity lifecycle verification unavailable")
    nonce = secrets.token_urlsafe(32)
    try:
        with httpx.Client(
            timeout=5, follow_redirects=False, trust_env=False, verify=tls_verify(settings)
        ) as client:
            response = client.post(
                url,
                headers={"Authorization": "Bearer " + secret},
                json={
                    "issuer": settings.oidc_issuer,
                    "subject": subject,
                    "access_group_id": settings.oidc_access_group_id,
                    "nonce": nonce,
                },
            )
            response.raise_for_status()
            payload = response.json()
        if (
            not isinstance(payload, dict)
            or payload.get("issuer") != settings.oidc_issuer
            or payload.get("subject") != subject
            or payload.get("access_group_id") != settings.oidc_access_group_id
            or payload.get("nonce") != nonce
            or payload.get("source_available") is not True
            or type(payload.get("enabled")) is not bool
            or type(payload.get("keycloak_access")) is not bool
            or not isinstance(payload.get("groups"), list)
            or any(not isinstance(group, str) or not group for group in payload["groups"])
            or type(payload.get("checked_at")) not in (int, float)
            or not time.time() - 30 <= payload["checked_at"] <= time.time() + 5
        ):
            raise ValueError("Invalid upstream verification response")
        return IdentityStatus(
            payload["enabled"], frozenset(payload["groups"]), payload["keycloak_access"]
        )
    except (httpx.HTTPError, httpx.InvalidURL, ValueError, TypeError, KeyError, OSError):
        raise HTTPException(503, "Identity lifecycle verification unavailable") from None


def check_identity(db, settings, subject: str, user_id: str | None = None) -> IdentityStatus:
    if not lifecycle_configured(settings):
        raise HTTPException(503, "Identity lifecycle verification unavailable")
    prefix = settings.oidc_issuer + "|"
    if not subject.startswith(prefix):
        raise HTTPException(401, "Account unavailable")
    status = keycloak_status(settings, subject[len(prefix) :])
    if status.enabled:
        upstream = upstream_status(settings, subject[len(prefix) :])
        if (
            upstream.enabled
            and upstream.keycloak_access
            and settings.oidc_access_group_id in upstream.groups
        ):
            if settings.oidc_access_group_id not in status.groups:
                # Offset pagination may skip a group during concurrent changes.
                raise HTTPException(503, "Identity lifecycle verification unavailable")
            return IdentityStatus(True, status.groups & upstream.groups)
    with db.lifecycle_lock:
        db.lifecycle_epochs[subject] = db.lifecycle_epochs.get(subject, 0) + 1
        # A concurrent first login may have created the user after the lookup.
        with db.session() as s:
            user_id = s.scalar(select(User.id).where(User.subject == subject))
        if user_id:
            revoke_identity_credentials(db, user_id)
    raise HTTPException(401, "Account unavailable")


def identity_epoch(db, subject: str) -> int:
    with db.lifecycle_lock:
        return db.lifecycle_epochs.get(subject, 0)


def assert_identity_epoch(db, subject: str | None, epoch: int | None) -> None:
    # Call under lifecycle_lock so a denial cannot race the following DB write.
    if epoch is not None and db.lifecycle_epochs.get(subject, 0) != epoch:
        raise HTTPException(401, "Account unavailable")
