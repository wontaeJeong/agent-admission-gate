import asyncio
import base64
import hashlib
import secrets
import time
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select, update

from .auth import Actor, actor, digest, issue_key, issue_session, password_matches
from .db import audit, record
from .models import APIKey, DeviceClient, DeviceGrant, OIDCState, Session, Usage, User
from .schemas import (
    DeviceAuthorize,
    DeviceDecision,
    DevicePoll,
    KeyRequest,
    Login,
    NameRequest,
    Reason,
)

router = APIRouter(prefix="/api")


def limit(request, category, count=20):
    ip = request.client.host if request.client else "unknown"
    request.app.state.limiter.check((category, ip), count)


@router.get("/auth/config")
def auth_config(request: Request):
    settings = request.app.state.settings
    return {
        "mode": settings.auth_mode,
        "boards_enabled": settings.boards_enabled,
        "environment": settings.environment,
    }


@router.post("/auth/login")
async def login(data: Login, request: Request, response: Response):
    settings, db = request.app.state.settings, request.app.state.db
    if settings.auth_mode != "local":
        raise HTTPException(404, "Local login disabled")
    if request.headers.get("origin") != settings.public_url.rstrip("/"):
        raise HTTPException(403, "Same-origin request required")
    limit(request, "login", 10)
    with db.session() as s:
        user = s.scalar(select(User).where(User.subject == "local:" + data.username))
    # Always perform a password derivation to avoid a username timing oracle.
    stored = user.password_hash if user else request.app.state.dummy_password_hash
    valid = await asyncio.to_thread(password_matches, data.password.get_secret_value(), stored)
    if not user or not user.active or not valid:
        raise HTTPException(401, "Invalid credentials")
    with db.session.begin() as s:
        issue_session(s, user, response, settings)
        audit(s, user.id, "auth.login", user.id)
    return {"ok": True}


@router.get("/auth/me")
def me(a: Actor = Depends(actor)):
    return {
        "id": a.id,
        "name": a.name,
        "role": a.role,
        "reviewer": a.reviewer,
        "api_key": bool(a.key_id),
    }


@router.post("/auth/logout")
def logout(request: Request, response: Response, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session.begin() as s:
        s.execute(
            delete(Session).where(Session.digest == digest(request.cookies.get("aag_session", "")))
        )
    response.delete_cookie("aag_session", path="/")
    return {"ok": True}


async def discovery(settings):
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        r = await client.get(settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration")
        r.raise_for_status()
        metadata = r.json()
    if metadata.get("issuer") != settings.oidc_issuer or any(
        not metadata[k].startswith("https://")
        for k in ("authorization_endpoint", "token_endpoint", "jwks_uri")
    ):
        raise HTTPException(502, "Invalid OIDC provider metadata")
    return metadata


@router.get("/auth/oidc/login")
async def oidc_login(request: Request):
    settings = request.app.state.settings
    if settings.auth_mode != "oidc":
        raise HTTPException(404, "OIDC disabled")
    limit(request, "oidc", 15)
    metadata = await discovery(settings)
    state, verifier, nonce = (secrets.token_urlsafe(32) for _ in range(3))
    with request.app.state.db.session.begin() as s:
        s.execute(delete(OIDCState).where(OIDCState.expires_at < time.time()))
        s.add(
            OIDCState(
                digest=digest(state), verifier=verifier, nonce=nonce, expires_at=time.time() + 600
            )
        )
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    response = RedirectResponse(
        metadata["authorization_endpoint"]
        + "?"
        + urlencode(
            {
                "client_id": settings.oidc_client_id,
                "response_type": "code",
                "scope": "openid profile",
                "redirect_uri": settings.public_url.rstrip("/") + "/sso/callback",
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
    )
    response.set_cookie(
        "aag_oidc",
        state,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=600,
        path="/sso/callback",
    )
    return response


async def oidc_callback(request, code, state):
    settings = request.app.state.settings
    if settings.auth_mode != "oidc" or not secrets.compare_digest(
        state, request.cookies.get("aag_oidc", "")
    ):
        raise HTTPException(400, "Invalid sign-in state")
    with request.app.state.db.session.begin() as s:
        flow = s.get(OIDCState, digest(state))
        if not flow or flow.expires_at <= time.time():
            raise HTTPException(400, "Sign-in expired")
        s.delete(flow)
    metadata = await discovery(settings)
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        r = await client.post(
            metadata["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "client_id": settings.oidc_client_id,
                "client_secret": settings.oidc_client_secret.get_secret_value(),
                "redirect_uri": settings.public_url.rstrip("/") + "/sso/callback",
                "code": code,
                "code_verifier": flow.verifier,
            },
        )
        if r.status_code != 200:
            raise HTTPException(401, "Identity provider rejected sign-in")
        token = r.json().get("id_token", "")
    try:
        key = await asyncio.to_thread(
            jwt.PyJWKClient(metadata["jwks_uri"]).get_signing_key_from_jwt, token
        )
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.oidc_client_id,
            issuer=settings.oidc_issuer,
            options={"require": ["exp", "iat", "sub", "nonce", "aud", "iss"]},
        )
        if (
            not secrets.compare_digest(claims["nonce"], flow.nonce)
            or claims.get("azp", settings.oidc_client_id) != settings.oidc_client_id
        ):
            raise ValueError("Invalid nonce or authorized party")
    except Exception as e:
        raise HTTPException(401, "Invalid identity token") from e
    with request.app.state.db.session.begin() as s:
        subject = settings.oidc_issuer + "|" + claims["sub"]
        user = s.scalar(select(User).where(User.subject == subject))
        if not user:
            user = User(
                subject=subject,
                name=str(claims.get("preferred_username", claims["sub"]))[:120],
                role="admin" if claims["sub"] in settings.oidc_admin_subjects else "user",
            )
            s.add(user)
            s.flush()
        if not user.active:
            raise HTTPException(403, "Account disabled")
        response = RedirectResponse("/", status_code=303)
        issue_session(s, user, response, settings)
        response.delete_cookie("aag_oidc", path="/sso/callback")
        audit(s, user.id, "auth.oidc", user.id)
    return response


def key_rows(s, owner=None):
    q = select(APIKey).order_by(APIKey.created_at.desc())
    if owner:
        q = q.where(APIKey.owner_id == owner)
    rows = []
    for key in s.scalars(q.limit(500)):
        uses = s.scalars(
            select(Usage).where(
                Usage.key_id == key.id, Usage.created_at >= time.time() - 30 * 86400
            )
        ).all()
        rows.append(
            {
                **record(key, ("digest",)),
                "display_key": "aag_sk_****" + key.suffix,
                "issuer": s.get(User, key.owner_id).name,
                "requests_30d": len(uses),
                "active_days_30d": len({int(u.created_at // 86400) for u in uses}),
                "state": "revoked"
                if key.revoked_at
                else "expired"
                if key.expires_at <= time.time()
                else "active",
            }
        )
    return rows


@router.get("/api-keys")
def keys(request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session() as s:
        return key_rows(s, a.id)


@router.post("/api-keys", status_code=201)
def create_key(data: KeyRequest, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session.begin() as s:
        key, token = issue_key(s, a.id, data.name, data.days, data.scopes)
        return {**record(key, ("digest",)), "token": token}


@router.post("/api-keys/{key_id}/revoke")
def revoke_key(key_id: str, data: Reason, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session.begin() as s:
        key = s.get(APIKey, key_id)
        if not key or key.owner_id != a.id:
            raise HTTPException(404, "Key not found")
        if not key.revoked_at:
            key.revoked_at = time.time()
            audit(s, a.id, "key.revoke", key_id, reason=data.reason)
    return {"ok": True}


@router.get("/device-clients")
def clients(request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session() as s:
        return [
            record(c)
            for c in s.scalars(
                select(DeviceClient)
                .where(DeviceClient.owner_id == a.id)
                .order_by(DeviceClient.created_at.desc())
            )
        ]


@router.post("/device-clients", status_code=201)
def create_client(data: NameRequest, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session.begin() as s:
        client = DeviceClient(owner_id=a.id, name=data.name)
        s.add(client)
        s.flush()
        audit(s, a.id, "device.register", client.id)
        return record(client)


@router.delete("/device-clients/{client_id}")
def disable_client(client_id: str, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session.begin() as s:
        client = s.get(DeviceClient, client_id)
        if not client or client.owner_id != a.id:
            raise HTTPException(404, "Client not found")
        client.active = False
        s.execute(
            update(DeviceGrant)
            .where(
                DeviceGrant.client_id == client_id, DeviceGrant.status.in_(["pending", "approved"])
            )
            .values(status="denied")
        )
        audit(s, a.id, "device.disable", client_id)
    return {"ok": True}


@router.post("/device/authorize")
def authorize_device(data: DeviceAuthorize, request: Request):
    limit(request, "device-start", 15)
    code = secrets.token_urlsafe(40)
    with request.app.state.db.session.begin() as s:
        client = s.get(DeviceClient, data.client_id)
        if not client or not client.active:
            raise HTTPException(400, "Unknown client")
        grant = DeviceGrant(
            digest=digest(code),
            user_code="".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8)),
            client_id=client.id,
            expires_at=time.time() + 600,
        )
        s.add(grant)
        s.flush()
        return {
            "device_code": code,
            "user_code": grant.user_code,
            "verification_uri": request.app.state.settings.public_url.rstrip("/")
            + "/device-clients",
            "expires_in": 600,
            "interval": 5,
        }


@router.get("/device/verify/{user_code}")
def verify_device(user_code: str, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    limit(request, "device-verify", 10)
    with request.app.state.db.session() as s:
        grant = s.scalar(
            select(DeviceGrant).where(
                DeviceGrant.user_code == user_code,
                DeviceGrant.status == "pending",
                DeviceGrant.expires_at > time.time(),
            )
        )
        if not grant:
            raise HTTPException(404, "Code unavailable")
        client = s.get(DeviceClient, grant.client_id)
        return {
            "client_name": client.name,
            "client_owner": s.get(User, client.owner_id).name,
            "user_code": grant.user_code,
            "scopes": ["scan:read", "scan:write"],
            "key_days": 90,
        }


@router.post("/device/decision")
def decide_device(data: DeviceDecision, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    limit(request, "device-decision", 10)
    with request.app.state.db.session.begin() as s:
        changed = s.execute(
            update(DeviceGrant)
            .where(
                DeviceGrant.user_code == data.user_code,
                DeviceGrant.status == "pending",
                DeviceGrant.expires_at > time.time(),
            )
            .values(status="approved" if data.approve else "denied", user_id=a.id)
        ).rowcount
        if changed != 1:
            raise HTTPException(409, "Code expired or already used")
        audit(s, a.id, "device.approve" if data.approve else "device.deny", data.user_code)
    return {"ok": True}


@router.post("/device/token")
def poll_device(data: DevicePoll, request: Request):
    limit(request, "device-poll", 60)
    now = time.time()
    error = None
    with request.app.state.db.session.begin() as s:
        grant = s.get(DeviceGrant, digest(data.device_code.get_secret_value()))
        if not grant or grant.client_id != data.client_id or grant.expires_at <= now:
            return Response('{"error":"expired_token"}', 400, media_type="application/json")
        if now - grant.last_poll_at < 5:
            error = "slow_down"
        else:
            grant.last_poll_at = now
            if grant.status == "pending":
                error = "authorization_pending"
            elif grant.status != "approved":
                error = "access_denied"
            else:
                client = s.get(DeviceClient, grant.client_id)
                user = s.get(User, grant.user_id)
                if not client.active or not user or not user.active:
                    error = "access_denied"
                else:
                    changed = s.execute(
                        update(DeviceGrant)
                        .where(DeviceGrant.digest == grant.digest, DeviceGrant.status == "approved")
                        .values(status="consumed")
                    ).rowcount
                    if changed != 1:
                        error = "access_denied"
                    else:
                        key, token = issue_key(s, user.id, "Device: " + client.name)
                        return {
                            "access_token": token,
                            "token_type": "Bearer",
                            "expires_in": 90 * 86400,
                            "key_id": key.id,
                        }
    return Response(
        content='{"error":"' + error + '"}', status_code=400, media_type="application/json"
    )
