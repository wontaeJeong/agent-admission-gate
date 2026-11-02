import time

from sqlalchemy import select

from .models import Job, Review


def utc_window_start(days: int) -> int:
    """Start of the inclusive UTC calendar-day window used by dashboards."""
    return (int(time.time() // 86400) - days + 1) * 86400


def job_scope_filters(actor, scope: str):
    if scope == "personal":
        return [Job.owner_id == actor.id]
    if scope == "review":
        return [Job.id.in_(select(Review.job_id))]
    return []
