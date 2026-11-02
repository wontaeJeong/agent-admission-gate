import csv
import io
import json
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import and_, case, func, or_, select

from .auth import Actor, actor
from .db import audit, record
from .models import APIKey, Audit, ExceptionRule, Usage, User
from .policy import RULES
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


def admin_key_record(key: APIKey, owner_name: str, now: float):
    return {
        **record(key, ("digest",)),
        "display_key": "aag_sk_****" + key.suffix,
        "issuer": owner_name,
        "state": "revoked"
        if key.revoked_at is not None
        else "expired"
        if key.expires_at <= now
        else "active",
    }


def key_http_filter():
    # Historical mcp:* entries are selected tool invocations, not HTTP requests.
    return or_(
        and_(Usage.kind == "api", or_(Usage.route.is_(None), ~Usage.route.like("mcp:%"))),
        Usage.kind == "mcp_http",
    )


def key_event_unit():
    return case(
        (Usage.kind == "mcp_http", "mcp_http"),
        (Usage.route.like("mcp:%"), "legacy_mcp_tool"),
        else_="rest_http",
    )


def mcp_collection(s, now: float):
    marker = s.get(Usage, "system:mcp-http-collection-start")
    started = (
        marker.created_at
        if marker
        and marker.kind == "mcp_http_start"
        and marker.user_id is None
        and marker.key_id is None
        else None
    )
    coverage = (
        "unknown"
        if started is None or started > now
        else "partial"
        if started > now - 30 * 86400
        else "possibly_partial"
    )
    return {"coverage": coverage, "collection_started_at": started}


@router.get("/api-keys")
def legacy_admin_keys(request: Request, response: Response, a: Actor = Depends(actor)):
    a.admin()
    now = time.time()
    response.headers["Deprecation"] = "true"
    response.headers["Link"] = '</api/admin/api-keys/search>; rel="successor-version"'
    response.headers["X-AAG-Usage-Note"] = (
        "Recorded HTTP requests only; MCP HTTP history may be incomplete"
    )
    with request.app.state.db.session() as s:
        coverage = mcp_collection(s, now)
        total = s.scalar(select(func.count()).select_from(APIKey))
        rows = s.execute(
            select(APIKey, User.name)
            .join(User, APIKey.owner_id == User.id)
            .order_by(APIKey.created_at.desc(), APIKey.id.desc())
            .limit(500)
        ).all()
        response.headers["X-Total-Count"] = str(total)
        response.headers["X-Result-Limit"] = "500"
        response.headers["X-Results-Truncated"] = str(total > len(rows)).lower()
        counts = {
            key_id: (requests, days)
            for key_id, requests, days in s.execute(
                select(
                    Usage.key_id,
                    func.count(),
                    func.count(func.distinct(func.floor(Usage.created_at / 86400))),
                )
                .where(
                    Usage.key_id.in_([key.id for key, _ in rows]),
                    key_http_filter(),
                    Usage.created_at >= now - 30 * 86400,
                    Usage.created_at <= now,
                )
                .group_by(Usage.key_id)
            )
        }
        return [
            {
                **admin_key_record(key, owner, now),
                "requests_30d": counts.get(key.id, (0, 0))[0],
                "active_days_30d": counts.get(key.id, (0, 0))[1],
                "mcp_http_coverage_30d": coverage,
            }
            for key, owner in rows
        ]


@router.get("/api-keys/search")
def admin_keys(
    request: Request,
    page: int = Query(1, ge=1, le=1_000_000_000),
    q: str = Query("", max_length=120),
    state: Literal["all", "active", "expired", "revoked"] = "all",
    a: Actor = Depends(actor),
):
    a.admin()
    now, page_size = time.time(), 20
    query = select(APIKey, User.name).join(User, APIKey.owner_id == User.id)
    if q := q.strip():
        query = query.where(
            or_(
                APIKey.name.icontains(q, autoescape=True),
                APIKey.id.icontains(q, autoescape=True),
                APIKey.suffix.icontains(q, autoescape=True),
                User.name.icontains(q, autoescape=True),
            )
        )
    if state == "revoked":
        query = query.where(APIKey.revoked_at.is_not(None))
    elif state == "expired":
        query = query.where(APIKey.revoked_at.is_(None), APIKey.expires_at <= now)
    elif state == "active":
        query = query.where(APIKey.revoked_at.is_(None), APIKey.expires_at > now)
    with request.app.state.db.session() as s:
        total = s.scalar(select(func.count()).select_from(query.subquery()))
        rows = s.execute(
            query.order_by(APIKey.created_at.desc(), APIKey.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        return {
            "items": [admin_key_record(key, owner, now) for key, owner in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }


@router.get("/api-keys/{key_id}")
def admin_key_detail(
    key_id: str,
    request: Request,
    usage_page: int = Query(1, ge=1, le=1_000_000_000),
    audit_page: int = Query(1, ge=1, le=1_000_000_000),
    a: Actor = Depends(actor),
):
    a.admin()
    now, page_size = time.time(), 20
    with request.app.state.db.session() as s:
        row = s.execute(
            select(APIKey, User.name)
            .join(User, APIKey.owner_id == User.id)
            .where(APIKey.id == key_id)
        ).first()
        if not row:
            raise HTTPException(404, "Key not found")
        key, owner = row
        unit = key_event_unit()
        event_filter = (Usage.key_id == key_id, Usage.kind.in_(("api", "mcp_http")))
        usage = select(Usage).where(*event_filter)
        recent_filter = (
            *event_filter,
            Usage.created_at >= now - 30 * 86400,
            Usage.created_at <= now,
        )
        totals = {
            event_unit: {"count": count, "days": days, "errors": errors}
            for event_unit, count, days, errors in s.execute(
                select(
                    unit,
                    func.count(),
                    func.count(func.distinct(func.floor(Usage.created_at / 86400))),
                    func.coalesce(func.sum(case((Usage.status >= 400, 1), else_=0)), 0),
                )
                .where(*recent_filter)
                .group_by(unit)
            )
        }
        rest = totals.get("rest_http", {"count": 0, "days": 0, "errors": 0})
        mcp = totals.get("mcp_http", {"count": 0, "days": 0, "errors": 0})
        legacy = totals.get("legacy_mcp_tool", {"count": 0, "days": 0, "errors": 0})
        coverage = mcp_collection(s, now)
        routes = s.execute(
            select(unit, Usage.route, func.count().label("count"))
            .where(*recent_filter)
            .group_by(unit, Usage.route)
            .order_by(func.count().desc(), unit, Usage.route)
        ).all()
        usage_total = s.scalar(select(func.count()).select_from(usage.subquery()))
        usage_rows = s.execute(
            select(Usage, unit)
            .where(*event_filter)
            .order_by(Usage.created_at.desc(), Usage.id.desc())
            .offset((usage_page - 1) * page_size)
            .limit(page_size)
        ).all()
        audit_query = (
            select(Audit, User.name)
            .outerjoin(User, Audit.actor_id == User.id)
            .where(
                Audit.target_id == key_id,
                Audit.action.in_(("key.create", "key.revoke", "key.admin_revoke")),
            )
        )
        audit_total = s.scalar(select(func.count()).select_from(audit_query.subquery()))
        audit_rows = s.execute(
            audit_query.order_by(Audit.created_at.desc(), Audit.id.desc())
            .offset((audit_page - 1) * page_size)
            .limit(page_size)
        ).all()
        return {
            "key": admin_key_record(key, owner, now),
            "usage": {
                "summary": {
                    "rest_http": {
                        "requests_30d": rest["count"],
                        "active_days_30d": rest["days"],
                        "errors_30d": rest["errors"],
                    },
                    "mcp_http": {
                        "observed_requests_30d": mcp["count"],
                        "active_days_30d": mcp["days"],
                        "transport_errors_30d": mcp["errors"],
                        **coverage,
                    },
                    "legacy_mcp_tool": {"events_30d": legacy["count"]},
                    "routes_30d": [
                        {"unit": event_unit, "route": route, "count": count}
                        for event_unit, route, count in routes
                    ],
                },
                "items": [
                    {
                        "id": u.id,
                        "unit": event_unit,
                        "created_at": u.created_at,
                        "route": u.route,
                        "status": u.status,
                        "latency_ms": u.latency_ms,
                    }
                    for u, event_unit in usage_rows
                ],
                "total": usage_total,
                "page": usage_page,
                "page_size": page_size,
            },
            "audit": {
                "items": [
                    {
                        "id": entry.id,
                        "created_at": entry.created_at,
                        "action": entry.action,
                        "actor": actor_name,
                        "reason": (entry.details or {}).get("reason"),
                    }
                    for entry, actor_name in audit_rows
                ],
                "total": audit_total,
                "page": audit_page,
                "page_size": page_size,
            },
        }


@router.post("/api-keys/{key_id}/revoke")
def revoke(key_id: str, data: Reason, request: Request, a: Actor = Depends(actor)):
    a.admin()
    reason = data.reason.strip()
    if len(reason) < 5:
        raise HTTPException(422, "Revocation reason must contain at least 5 characters")
    with request.app.state.db.session.begin() as s:
        key = s.get(APIKey, key_id)
        if not key:
            raise HTTPException(404, "Key not found")
        if not key.revoked_at:
            key.revoked_at = time.time()
            audit(s, a.id, "key.admin_revoke", key_id, reason=reason, owner_id=key.owner_id)
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


@router.get("/audit/export")
def export_audit(
    request: Request,
    days: int = Query(30, ge=1, le=90),
    action: str = "",
    a: Actor = Depends(actor),
):
    a.admin()
    query = select(Audit).where(Audit.created_at >= time.time() - days * 86400)
    if action:
        query = query.where(Audit.action == action)
    query = query.order_by(Audit.created_at.desc(), Audit.id.desc()).limit(100001)
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["id", "created_at", "actor_id", "action", "target_id", "details"])
    with request.app.state.db.session() as s:
        rows = s.scalars(query).all()
        if len(rows) > 100000:
            raise HTTPException(422, "Export exceeds 100,000 rows; choose a shorter window")
        for row in rows:
            values = [
                row.id,
                row.created_at,
                row.actor_id,
                row.action,
                row.target_id,
                json.dumps(row.details, ensure_ascii=False),
            ]
            writer.writerow(
                [
                    "'" + value
                    if isinstance(value, str)
                    and value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@"))
                    else value
                    for value in values
                ]
            )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="aag-audit.csv"',
            "Cache-Control": "no-store",
        },
    )


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
