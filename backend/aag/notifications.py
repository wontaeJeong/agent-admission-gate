"""Transactional in-app delivery. Mail delivery can consume domain events separately later."""

import time
from typing import Literal

from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import Job, Notification, NotificationInbox, NotificationPreference, Review, User

RETENTION_SECONDS = 90 * 86400
Category = Literal["all", "scans", "reviews", "comments"]
State = Literal["all", "unread", "archived"]
PREFERENCES = ("scans", "review_requests", "review_results", "comments")
EVENT_PREFERENCE = {
    "scan.completed": "scans",
    "scan.failed": "scans",
    "scan.cancelled": "scans",
    "review.requested": "review_requests",
    "review.approved": "review_results",
    "review.rejected": "review_results",
    "comment.created": "comments",
}


def conflict_insert(s, model):
    # Both supported databases provide atomic ON CONFLICT without rolling back
    # the business transaction when another delivery wins the uniqueness race.
    return (sqlite_insert if s.bind.dialect.name == "sqlite" else pg_insert)(model)


def preference_values(row):
    return {name: getattr(row, name) if row else True for name in PREFERENCES}


def emit_notification(s, kind, job, recipients, event_key, review_id=None):
    preference = EVENT_PREFERENCE[kind]
    recipients = set(recipients)
    if not recipients:
        return
    query = (
        select(User.id)
        .outerjoin(NotificationPreference, NotificationPreference.user_id == User.id)
        .where(
            User.id.in_(recipients),
            User.active.is_(True),
            or_(
                NotificationPreference.user_id.is_(None),
                getattr(NotificationPreference, preference).is_(True),
            ),
        )
    )
    if kind == "review.requested":
        query = query.where(User.reviewer.is_(True), User.id != job.owner_id)
    for recipient in s.scalars(query.order_by(User.id)):
        # Held until commit: a plain DB sequence permits allocations to commit
        # out of order and cannot define a committed inbox snapshot.
        sequence = s.execute(
            conflict_insert(s, NotificationInbox)
            .values(user_id=recipient, sequence=1)
            .on_conflict_do_update(
                index_elements=["user_id"], set_={"sequence": NotificationInbox.sequence + 1}
            )
            .returning(NotificationInbox.sequence)
        ).scalar_one()
        s.execute(
            conflict_insert(s, Notification)
            .values(
                recipient_id=recipient,
                event_key=event_key,
                sequence=sequence,
                kind=kind,
                job_id=job.id,
                review_id=review_id,
                verdict=job.effective_verdict if kind != "comment.created" else None,
            )
            .on_conflict_do_nothing(index_elements=["recipient_id", "event_key"])
        )


def notify_terminal(s, job):
    emit_notification(
        s, "scan." + job.status.lower(), job, [job.owner_id], "scan.terminal:" + job.id
    )


def visible_notifications(a, now):
    """Use the same live authorization for listing, counts, and every mutation."""
    query = (
        select(Notification)
        .join(Job, Job.id == Notification.job_id)
        .outerjoin(Review, Review.id == Notification.review_id)
        .where(
            Notification.recipient_id == a.id,
            Notification.created_at >= now - RETENTION_SECONDS,
            Notification.created_at <= now,
        )
    )
    if not a.staff:
        query = query.where(
            Job.owner_id == a.id,
            or_(Notification.review_id.is_(None), Review.requester_id == a.id),
        )
    if not a.reviewer:
        query = query.where(Notification.kind != "review.requested")
    return query


def filtered_notifications(query, state: State = "all", category: Category = "all"):
    query = query.where(
        Notification.archived_at.is_not(None)
        if state == "archived"
        else Notification.archived_at.is_(None)
    )
    if state == "unread":
        query = query.where(Notification.read_at.is_(None))
    if category != "all":
        prefix = {"scans": "scan.", "reviews": "review.", "comments": "comment."}[category]
        query = query.where(Notification.kind.startswith(prefix))
    return query


def notification_record(n, source):
    return {
        "id": n.id,
        "kind": n.kind,
        "source": source,
        "href": f"/reviews/{n.review_id}" if n.review_id else f"/jobs/{n.job_id}",
        "verdict": n.verdict,
        "created_at": n.created_at,
        "read_at": n.read_at,
        "archived_at": n.archived_at,
    }


def prune_notifications(s, now=None, batch_size=5000):
    cutoff = (time.time() if now is None else now) - RETENTION_SECONDS
    expired = (
        select(Notification.id)
        .where(Notification.created_at < cutoff)
        .order_by(Notification.created_at)
        .limit(batch_size)
    )
    return s.execute(delete(Notification).where(Notification.id.in_(expired))).rowcount
