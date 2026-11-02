import csv
import io
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import Integer, case, cast, func, select

from .auth import Actor, actor
from .job_query import job_scope_filters, utc_window_start
from .models import Job, Review, Usage
from .usage import MCP_HTTP_START_ID, legacy_mcp_tool_filter, rest_http_filter, usage_unit

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
    cutoff = utc_window_start(days)
    today = cutoff // 86400 + days - 1
    job_filters = [Job.created_at >= cutoff, *job_scope_filters(a, scope)]
    usage_filters = [Usage.created_at >= cutoff]
    if scope != "all":
        usage_filters.append(Usage.user_id == a.id)
    with request.app.state.db.session() as s:
        marker = s.get(Usage, MCP_HTTP_START_ID)
        mcp_observed_since = (
            marker.created_at if marker is not None and marker.kind == "mcp_http_start" else None
        )
        mcp_start_day = int(mcp_observed_since // 86400) if mcp_observed_since is not None else None
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

        def days_for(event_filter):
            return dict(
                s.execute(
                    select(uday, func.count()).where(*usage_filters, event_filter).group_by(uday)
                ).all()
            )

        rest_days = days_for(rest_http_filter())
        mcp_days = days_for(Usage.kind == "mcp_http")
        legacy_days = days_for(legacy_mcp_tool_filter())
        api_days = days_for(Usage.kind == "api")  # Deprecated mixed-unit compatibility field.
        series = [
            {
                "date": time.strftime("%Y-%m-%d", time.gmtime(d * 86400)),
                "scans": scan_days.get(d, 0),
                "api_requests": api_days.get(d, 0),
                "rest_http_requests": rest_days.get(d, 0),
                "mcp_http_requests": (
                    mcp_days.get(d, 0) if mcp_start_day is not None and d >= mcp_start_day else None
                ),
                "mcp_http_coverage": (
                    "unknown"
                    if mcp_start_day is None or d < mcp_start_day
                    else "partial"
                    if d == mcp_start_day
                    else "possibly_partial"
                ),
                "legacy_mcp_tool_calls": legacy_days.get(d, 0),
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

        def request_stats(event_filter):
            count, errors, latency = s.execute(
                select(
                    func.count(),
                    func.sum(case((Usage.status >= 400, 1), else_=0)),
                    func.avg(Usage.latency_ms),
                ).where(*usage_filters, event_filter)
            ).one()
            return {"requests": count, "errors": errors or 0, "latency_ms": latency}

        legacy_count = s.scalar(
            select(func.count()).select_from(Usage).where(*usage_filters, legacy_mcp_tool_filter())
        )
        recent = s.scalars(select(Job).where(*job_filters).order_by(Job.created_at.desc()).limit(5))
        return {
            "days": days,
            "timezone": "UTC",
            "scope": scope,
            "usage_scope": "all" if scope == "all" else "personal",
            "deprecated_fields": ["api", "series.api_requests"],
            "mcp_http_observed_since": mcp_observed_since,
            "series": series,
            "distribution": distribution,
            "statuses": statuses,
            "total_scans": sum(statuses.values()),
            "pending_reviews": pending,
            "oldest_review_seconds": time.time() - oldest if oldest else None,
            "api": request_stats(Usage.kind == "api"),
            "rest": request_stats(rest_http_filter()),
            "mcp": request_stats(Usage.kind == "mcp_http"),
            "legacy_mcp_tool_calls": legacy_count,
            "models": [dict(g) for g in groups],
            "recent": [
                {"id": j.id, "source": j.source, "status": j.status, "verdict": j.effective_verdict}
                for j in recent
            ],
        }


@router.get("/usage/export")
def export_usage(
    request: Request,
    days: int = Query(30, ge=1, le=90),
    scope: Literal["personal", "review", "all"] = "personal",
    a: Actor = Depends(actor),
):
    a.interactive()
    if scope == "all" and a.role != "admin":
        raise HTTPException(403, "Administrator required")
    if scope == "review" and not a.reviewer:
        raise HTTPException(403, "Reviewer required")
    cutoff = utc_window_start(days)
    query = (
        select(Usage)
        .where(Usage.created_at >= cutoff, Usage.kind != "mcp_http_start")
        .order_by(Usage.created_at.desc())
    )
    if scope != "all":
        query = query.where(Usage.user_id == a.id)
    output = io.StringIO()
    writer = csv.writer(output)
    fields = [
        "created_at",
        "kind",
        "protocol",
        "unit",
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
            protocol, unit = usage_unit(row)
            values = [
                protocol if f == "protocol" else unit if f == "unit" else getattr(row, f)
                for f in fields
            ]
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
