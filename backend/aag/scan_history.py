"""Owner-scoped target history and its deliberately limited public projection."""

from fastapi import HTTPException
from sqlalchemy import or_, select

from .models import Job, Review


def history_query(actor, reference_job):
    actor.scope("scan:read")
    if reference_job.owner_id != actor.id and (actor.key_id or not actor.staff):
        raise HTTPException(404, "Scan not found")
    query = select(Job).where(
        Job.owner_id == reference_job.owner_id, Job.source_type == reference_job.source_type
    )
    if reference_job.source_type == "git":
        # Submission already stores validate_git_url's normalized identity.
        return query.where(Job.source == reference_job.source)
    root = reference_job.lineage_root_id or reference_job.id
    return query.where(
        or_(Job.lineage_root_id == root, (Job.id == root) & Job.lineage_root_id.is_(None))
    )


def history_item(s, actor, job):
    """Never serialize raw results, errors, cache IDs or review relationship fields."""
    item = {
        key: getattr(job, key)
        for key in (
            "id",
            "source",
            "source_type",
            "ref",
            "resolved_commit",
            "target_commit",
            "profile",
            "status",
            "verdict",
            "effective_verdict",
            "created_at",
        )
    }
    result = job.result if isinstance(job.result, dict) else {}
    item["coverage_complete"] = result.get("coverage_complete") is True
    item["cached"] = bool(job.cached_from)
    engines = result.get("engines")
    item["engines"] = (
        [
            {key: engine.get(key) for key in ("name", "status")}
            for engine in engines
            if isinstance(engine, dict)
        ]
        if isinstance(engines, list)
        else []
    )
    if not actor.key_id:
        query = select(Review).where(Review.job_id == job.id)
        if not actor.staff:
            query = query.where(Review.requester_id == actor.id)
        review = s.scalar(query)
        if review:
            item["review"] = {
                "id": review.id,
                "status": review.status,
                "workflow_state": review.workflow_state,
            }
    return item
