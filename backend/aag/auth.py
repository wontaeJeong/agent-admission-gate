import asyncio
import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request
from sqlalchemy import select

from .db import audit
from .identity_lifecycle import (
    assert_identity_epoch,
    check_identity,
    identity_epoch,
    lifecycle_configured,
)
from .models import APIKey, Session, User


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    result = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000)
    return f"pbkdf2_sha256${salt}${base64.b64encode(result).decode()}"


def password_matches(password, encoded):
    if not encoded:
        return False
    return hmac.compare_digest(password_hash(password, encoded.split("$")[1]), encoded)


@dataclass
class Actor:
    id: str
    name: str
    role: str
    reviewer: bool
    key_id: str | None = None
    scopes: tuple[str, ...] = ()
    identity_subject: str | None = None
    identity_epoch: int | None = None

    @property
    def staff(self):
        return self.role == "admin" or self.reviewer

    def interactive(self):
        if self.key_id:
            raise HTTPException(403, "Interactive session required")

    def admin(self):
        self.interactive()
        if self.role != "admin":
            raise HTTPException(403, "Administrator required")

    def review(self):
        self.interactive()
        if not self.reviewer:
            raise HTTPException(403, "Reviewer qualification required")

    def scope(self, name):
        if self.key_id and name not in self.scopes:
            raise HTTPException(403, f"Required scope: {name}")


class RateLimiter:
    def __init__(self):
        self.buckets = defaultdict(deque)

    def check(self, key, limit=20, seconds=60):
        now = time.monotonic()
        bucket = self.buckets[key]
        while bucket and bucket[0] < now - seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(429, "Too many requests", headers={"Retry-After": str(seconds)})
        bucket.append(now)
        if len(self.buckets) > 10000:
            self.buckets = defaultdict(
                deque, {k: v for k, v in self.buckets.items() if v and v[-1] > now - 600}
            )


def authenticate(db, settings, authorization=None, cookie=None):
    now = time.time()
    key = None
    with db.session() as s:
        if authorization:
            require_api_keys(settings)
            parts = authorization.split()
            if len(parts) != 2 or parts[0].lower() != "bearer":
                raise HTTPException(401, "Invalid authorization header")
            key = s.scalar(select(APIKey).where(APIKey.digest == digest(parts[1])))
            if not key or key.revoked_at or key.expires_at <= now:
                raise HTTPException(401, "Invalid or expired API key")
            user = s.get(User, key.owner_id)
        elif cookie:
            session = s.get(Session, digest(cookie))
            if not session or session.expires_at <= now:
                raise HTTPException(401, "Session expired")
            user = s.get(User, session.user_id)
        else:
            raise HTTPException(401, "Authentication required")
        if not user or not user.active:
            raise HTTPException(401, "Account unavailable")
        user_id, subject = user.id, user.subject
    if settings.auth_mode == "oidc":
        if not subject.startswith(settings.oidc_issuer + "|"):
            raise HTTPException(401, "Account unavailable")
        epoch = (
            identity_epoch(db, subject)
            if authorization or settings.oidc_lifecycle_sync_confirmed
            else None
        )
        identity = (
            check_identity(db, settings, subject, user_id)
            if authorization or settings.oidc_lifecycle_sync_confirmed
            else None
        )
    elif subject.startswith("local:"):
        identity = None
        epoch = None
    else:
        raise HTTPException(401, "Account unavailable")
    # Recheck local revocations after the external lookup, then account for key usage.
    with db.lifecycle_lock, db.session.begin() as s:
        assert_identity_epoch(db, subject, epoch)
        user = s.get(User, user_id)
        if not user or not user.active or user.subject != subject:
            raise HTTPException(401, "Account unavailable")
        if authorization:
            key = s.scalar(select(APIKey).where(APIKey.digest == digest(parts[1])))
            if (
                not key
                or key.revoked_at
                or key.expires_at <= time.time()
                or key.owner_id != user_id
            ):
                raise HTTPException(401, "Invalid or expired API key")
            key.last_used_at = time.time()
        else:
            session = s.get(Session, digest(cookie))
            if not session or session.expires_at <= time.time() or session.user_id != user_id:
                raise HTTPException(401, "Session expired")
        return Actor(
            user.id,
            user.name,
            user.role
            if identity is None or settings.oidc_admin_group_id in identity.groups
            else "user",
            user.reviewer
            and (identity is None or settings.oidc_reviewer_group_id in identity.groups),
            key.id if key else None,
            tuple(key.scopes) if key else (),
            subject,
            epoch,
        )


async def actor(request: Request):
    a = await asyncio.to_thread(
        authenticate,
        request.app.state.db,
        request.app.state.settings,
        request.headers.get("authorization"),
        request.cookies.get("aag_session"),
    )
    if not a.key_id and request.method not in {"GET", "HEAD", "OPTIONS"}:
        # Cookie credentials require same-origin requests; API keys use explicit Bearer auth.
        if request.headers.get("origin") != request.app.state.settings.public_url.rstrip("/"):
            raise HTTPException(403, "Same-origin request required")
    request.state.actor = a
    return a


def require_api_keys(settings):
    state = api_keys_state(settings)
    if state == "disabled":
        raise HTTPException(503, "API keys are disabled")
    if state == "identity_unconfigured":
        raise HTTPException(503, "Identity lifecycle verification unavailable")


def api_keys_state(settings):
    if not settings.api_keys_enabled:
        return "disabled"
    if settings.auth_mode == "oidc" and not lifecycle_configured(settings):
        return "identity_unconfigured"
    return "available"


def ensure_user_current(db, settings, user_id):
    """Check an identity when there is no session, as in device-code polling."""
    with db.session() as s:
        user = s.get(User, user_id)
        if not user or not user.active:
            raise HTTPException(401, "Account unavailable")
        subject = user.subject
    if settings.auth_mode == "oidc":
        epoch = identity_epoch(db, subject)
        check_identity(db, settings, subject, user_id)
    elif not subject.startswith("local:"):
        raise HTTPException(401, "Account unavailable")
    else:
        epoch = None
    with db.lifecycle_lock, db.session() as s:
        assert_identity_epoch(db, subject, epoch)
        user = s.get(User, user_id)
        if not user or not user.active or user.subject != subject:
            raise HTTPException(401, "Account unavailable")
    return subject, epoch


def issue_session(s, user, response, settings):
    token = secrets.token_urlsafe(48)
    s.add(Session(digest=digest(token), user_id=user.id, expires_at=time.time() + 8 * 3600))
    response.set_cookie(
        "aag_session",
        token,
        max_age=8 * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


def issue_key(s, user_id, name, days=90, scopes=None):
    token = "aag_sk_" + secrets.token_urlsafe(32)
    key = APIKey(
        owner_id=user_id,
        name=name,
        digest=digest(token),
        suffix=token[-4:],
        expires_at=time.time() + days * 86400,
        scopes=scopes if scopes is not None else ["scan:read", "scan:write"],
    )
    s.add(key)
    s.flush()
    audit(s, user_id, "key.create", key.id, name=name)
    return key, token
