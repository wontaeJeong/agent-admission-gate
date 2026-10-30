import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select

from .auth import Actor, actor
from .db import audit, record
from .models import APIKey, Audit, ExceptionRule, User
from .policy import RULES
from .routes_identity import key_rows
from .schemas import ExceptionRequest, Reason, UserPatch

router = APIRouter(prefix="/api/admin")


@router.get("/status")
def status(request: Request, a: Actor = Depends(actor)):
    import shutil

    a.admin()
    settings = request.app.state.settings
    with request.app.state.db.session() as s:
        s.execute(select(1))
    return {
        "database": "ok",
        "active_jobs": len(request.app.state.scans.tasks),
        "concurrency": settings.runner_concurrency,
        "queue_capacity": settings.queue_capacity,
        "engines": {
            n: bool(shutil.which(n))
            for n in [
                "git",
                "skill-scanner",
                "mcp-scanner",
                "syft",
                "grype",
                "grant",
                "osv-scanner",
            ]
        },
        "policy_version": settings.policy_version,
        "scanner_revision": settings.scanner_revision,
        "boards_enabled": settings.boards_enabled,
    }


@router.get("/users")
def users(request: Request, a: Actor = Depends(actor)):
    a.admin()
    with request.app.state.db.session() as s:
        return [
            record(u, ("password_hash", "subject"))
            for u in s.scalars(select(User).order_by(User.created_at).limit(1000))
        ]


@router.patch("/users/{user_id}")
def update_user(user_id: str, data: UserPatch, request: Request, a: Actor = Depends(actor)):
    a.admin()
    with request.app.state.admin_lock, request.app.state.db.session.begin() as s:
        # Lock active admins together to serialize last-admin changes on PostgreSQL.
        admins = s.scalars(
            select(User).where(User.role == "admin", User.active.is_(True)).with_for_update()
        ).all()
        user = s.get(User, user_id)
        if not user:
            raise HTTPException(404, "User not found")
        if (
            user.role == "admin"
            and user.active
            and (data.role != "admin" or not data.active)
            and len(admins) <= 1
        ):
            raise HTTPException(409, "At least one active administrator must remain")
        old = {k: getattr(user, k) for k in type(data).model_fields}
        for k, v in data.model_dump().items():
            setattr(user, k, v)
        audit(s, a.id, "user.permissions", user_id, before=old, after=data.model_dump())
    return {"ok": True}


@router.get("/api-keys")
def admin_keys(request: Request, a: Actor = Depends(actor)):
    a.admin()
    with request.app.state.db.session() as s:
        return key_rows(s)


@router.post("/api-keys/{key_id}/revoke")
def revoke(key_id: str, data: Reason, request: Request, a: Actor = Depends(actor)):
    a.admin()
    with request.app.state.db.session.begin() as s:
        key = s.get(APIKey, key_id)
        if not key:
            raise HTTPException(404, "Key not found")
        if not key.revoked_at:
            key.revoked_at = time.time()
            audit(s, a.id, "key.admin_revoke", key_id, reason=data.reason, owner_id=key.owner_id)
    return {"ok": True}


@router.get("/audit")
def audit_log(
    request: Request, page: int = Query(1, ge=1), action: str = "", a: Actor = Depends(actor)
):
    a.admin()
    with request.app.state.db.session() as s:
        q = select(Audit)
        if action:
            q = q.where(Audit.action == action)
        total = s.scalar(select(func.count()).select_from(q.subquery()))
        return {
            "items": [
                record(r)
                for r in s.scalars(
                    q.order_by(Audit.created_at.desc()).offset((page - 1) * 50).limit(50)
                )
            ],
            "total": total,
        }


@router.get("/allowlist")
def exceptions(request: Request, a: Actor = Depends(actor)):
    a.admin()
    with request.app.state.db.session() as s:
        return [
            record(e)
            for e in s.scalars(
                select(ExceptionRule).order_by(ExceptionRule.expires_at.desc()).limit(1000)
            )
        ]


@router.post("/allowlist", status_code=201)
def add_exception(data: ExceptionRequest, request: Request, a: Actor = Depends(actor)):
    a.admin()
    if not time.time() < data.expires_at <= time.time() + 90 * 86400:
        raise HTTPException(422, "Expiry must be within 90 days")
    with request.app.state.db.session.begin() as s:
        e = ExceptionRule(**data.model_dump(), created_by=a.id)
        s.add(e)
        s.flush()
        audit(s, a.id, "exception.create", e.id, reason=data.reason)
        return record(e)


@router.delete("/allowlist/{rule_id}")
def remove_exception(rule_id: str, request: Request, a: Actor = Depends(actor)):
    a.admin()
    with request.app.state.db.session.begin() as s:
        e = s.get(ExceptionRule, rule_id)
        if not e:
            raise HTTPException(404, "Exception not found")
        e.active = False
        audit(s, a.id, "exception.revoke", e.id)
    return {"ok": True}


@router.get("/actions")
def actions(a: Actor = Depends(actor)):
    a.admin()
    return [
        {"id": r[0], "severity": r[1], "action": r[2], "title": r[4], "remediation": r[5]}
        for r in RULES
    ]


@router.get("/llm")
def llm_config(request: Request, a: Actor = Depends(actor)):
    a.admin()
    settings = request.app.state.settings
    return {
        "provider": settings.llm_provider,
        "model": settings.llm_model,
        "systemone_runtime": settings.systemone_runtime,
        "review_threshold": settings.systemone_review_threshold,
        "timeout": settings.llm_timeout,
        "credentials_configured": bool(settings.llm_api_key.get_secret_value()),
        "configuration": "Environment / deployment secret; never exposed through this API",
        "cost": "Unknown unless a measured billing record is provided; on-prem is not assumed free",
    }
