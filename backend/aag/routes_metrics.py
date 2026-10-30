import csv
import io
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import Integer, case, cast, func, select

from .auth import Actor, actor
from .models import Job, Review, Usage

router = APIRouter(prefix="/api")


@router.get("/metrics")
def metrics(
    request: Request,
    days: int = Query(30),
    scope: Literal["personal", "review", "all"] = "personal",
    a: Actor = Depends(actor),
):
    a.interactive()
    if days not in {7, 14, 30, 90}:
        raise HTTPException(422, "Days must be 7, 14, 30 or 90")
    if scope == "all" and a.role != "admin":
        raise HTTPException(403, "Administrator required")
    if scope == "review" and not a.reviewer:
        raise HTTPException(403, "Reviewer required")
    today = int(time.time() // 86400)
    cutoff = (today - days + 1) * 86400
    job_filters = [Job.created_at >= cutoff]
    usage_filters = [Usage.created_at >= cutoff]
    if scope == "personal":
        job_filters.append(Job.owner_id == a.id)
    if scope == "review":
        job_filters.append(Job.id.in_(select(Review.job_id)))
    if scope != "all":
        usage_filters.append(Usage.user_id == a.id)
    with request.app.state.db.session() as s:
        distribution = dict(
            s.execute(
                select(Job.effective_verdict, func.count())
                .where(*job_filters, Job.status == "COMPLETED")
                .group_by(Job.effective_verdict)
            ).all()
        )
        statuses = dict(
            s.execute(
                select(Job.status, func.count()).where(*job_filters).group_by(Job.status)
            ).all()
        )
        day = cast(Job.created_at / 86400, Integer)
        scan_days = dict(
            s.execute(select(day, func.count()).where(*job_filters).group_by(day)).all()
        )
        uday = cast(Usage.created_at / 86400, Integer)
        api_days = dict(
            s.execute(
                select(uday, func.count()).where(*usage_filters, Usage.kind == "api").group_by(uday)
            ).all()
        )
        series = [
            {
                "date": time.strftime("%Y-%m-%d", time.gmtime(d * 86400)),
                "scans": scan_days.get(d, 0),
                "api_requests": api_days.get(d, 0),
            }
            for d in range(today - days + 1, today + 1)
        ]
        groups = (
            s.execute(
                select(
                    Usage.provider,
                    Usage.model,
                    func.count().label("requests"),
                    func.sum(Usage.input_tokens).label("input_tokens"),
                    func.sum(Usage.output_tokens).label("output_tokens"),
                    func.sum(Usage.cache_read_tokens).label("cache_read_tokens"),
                    func.sum(Usage.cache_write_tokens).label("cache_write_tokens"),
                    func.sum(case((Usage.input_tokens.is_(None), 1), else_=0)).label(
                        "missing_input_usage"
                    ),
                    func.sum(case((Usage.output_tokens.is_(None), 1), else_=0)).label(
                        "missing_output_usage"
                    ),
                    func.sum(case((Usage.status >= 400, 1), else_=0)).label("errors"),
                    func.avg(Usage.latency_ms).label("latency_ms"),
                    func.sum(Usage.cost_usd).label("cost_usd"),
                    func.count(Usage.cost_usd).label("priced_requests"),
                )
                .where(*usage_filters, Usage.kind == "llm")
                .group_by(Usage.provider, Usage.model)
            )
            .mappings()
            .all()
        )
        rq = select(Review).where(Review.status == "pending")
        if scope == "personal":
            rq = rq.where(Review.requester_id == a.id)
        pending = s.scalar(select(func.count()).select_from(rq.subquery()))
        oldest = s.scalar(
            select(func.min(Review.created_at)).where(Review.id.in_(select(rq.subquery().c.id)))
        )
        api = s.execute(
            select(
                func.count(),
                func.sum(case((Usage.status >= 400, 1), else_=0)),
                func.avg(Usage.latency_ms),
            ).where(*usage_filters, Usage.kind == "api")
        ).one()
        recent = s.scalars(select(Job).where(*job_filters).order_by(Job.created_at.desc()).limit(5))
        return {
            "days": days,
            "timezone": "UTC",
            "scope": scope,
            "usage_scope": "all" if scope == "all" else "personal",
            "series": series,
            "distribution": distribution,
            "statuses": statuses,
            "total_scans": sum(statuses.values()),
            "pending_reviews": pending,
            "oldest_review_seconds": time.time() - oldest if oldest else None,
            "api": {"requests": api[0], "errors": api[1] or 0, "latency_ms": api[2]},
            "models": [dict(g) for g in groups],
            "recent": [
                {"id": j.id, "source": j.source, "status": j.status, "verdict": j.effective_verdict}
                for j in recent
            ],
        }


@router.get("/usage/export")
def export_usage(request: Request, days: int = Query(30, ge=1, le=90), a: Actor = Depends(actor)):
    a.interactive()
    query = (
        select(Usage)
        .where(Usage.created_at >= time.time() - days * 86400)
        .order_by(Usage.created_at.desc())
    )
    if a.role != "admin":
        query = query.where(Usage.user_id == a.id)
    output = io.StringIO()
    writer = csv.writer(output)
    fields = [
        "created_at",
        "kind",
        "provider",
        "model",
        "route",
        "status",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
        "cost_usd",
    ]
    writer.writerow(fields)
    with request.app.state.db.session() as s:
        rows = s.scalars(query.limit(100001)).all()
        if len(rows) > 100000:
            raise HTTPException(422, "Export exceeds 100,000 rows; choose a shorter window")
        for row in rows:
            values = [getattr(row, f) for f in fields]
            writer.writerow(
                [
                    "'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@")) else v
                    for v in values
                ]
            )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="aag-usage.csv"'},
    )
