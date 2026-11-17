"""Transactional in-app delivery. Mail delivery can consume domain events separately later."""

import time
from typing import Literal

from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import Notification, NotificationInbox, NotificationPreference, User
from .notification_targets import EVENT_PREFERENCE, resolve_target, target_record, target_visibility

RETENTION_SECONDS = 90 * 86400
Category = Literal["all", "scans", "reviews", "comments", "credentials", "exceptions"]
State = Literal["all", "unread", "archived"]
PREFERENCES = (
    "scans",
    "review_requests",
    "review_results",
    "review_updates",
    "comments",
    "credentials",
    "exceptions",
)


def conflict_insert(s, model):
    # Both supported databases provide atomic ON CONFLICT without rolling back
    # the business transaction when another delivery wins the uniqueness race.
    return (sqlite_insert if s.bind.dialect.name == "sqlite" else pg_insert)(model)


def preference_values(row):
    return {name: getattr(row, name) if row else True for name in PREFERENCES}


def emit_notification(s, kind, job, recipients, event_key, review_id=None, *, actor_id=None):
    resource_type = "review" if review_id else "scan"
    resource_id = review_id or job.id
    _, target_job = resolve_target(s, kind, resource_type, resource_id)
    if target_job.id != job.id:
        raise ValueError("Notification review belongs to a different scan")
    return emit_resource_notification(
        s, kind, resource_type, resource_id, set(recipients) - {None, actor_id}, event_key
    )


def emit_resource_notification(s, kind, resource_type, resource_id, recipients, event_key):
    """Stage delivery in the caller transaction; never commit or lock an actor."""
    _, job = resolve_target(s, kind, resource_type, resource_id)
    preference = EVENT_PREFERENCE[kind]
    recipients = set(recipients) - {None}
    query = (
        select(User.id)
        .outerjoin(NotificationPreference, NotificationPreference.user_id == User.id)
        .where(
            User.id.in_(recipients),
            target_visibility(resource_type, resource_id, kind),
            or_(
                NotificationPreference.user_id.is_(None),
                getattr(NotificationPreference, preference).is_(True),
            ),
        )
    )
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
                resource_type=resource_type,
                resource_id=resource_id,
                job_id=job.id if job else None,
                review_id=resource_id if resource_type == "review" else None,
                verdict=job.effective_verdict if job and kind != "comment.created" else None,
            )
            .on_conflict_do_nothing(index_elements=["recipient_id", "event_key"])
        )


def notify_terminal(s, job):
    emit_notification(
        s, "scan." + job.status.lower(), job, [job.owner_id], "scan.terminal:" + job.id
    )


def visible_notifications(a, now):
    """Use the same live authorization for listing, counts, and every mutation."""
    return select(Notification).where(
        Notification.recipient_id == a.id,
        Notification.created_at >= now - RETENTION_SECONDS,
        Notification.created_at <= now,
        select(User.id)
        .where(
            User.id == a.id,
            target_visibility(
                Notification.resource_type, Notification.resource_id, Notification.kind
            ),
        )
        .correlate(Notification)
        .exists(),
    )


def filtered_notifications(query, state: State = "all", category: Category = "all"):
    query = query.where(
        Notification.archived_at.is_not(None)
        if state == "archived"
        else Notification.archived_at.is_(None)
    )
    if state == "unread":
        query = query.where(Notification.read_at.is_(None))
    if category != "all":
        prefix = {
            "scans": "scan.",
            "reviews": "review.",
            "comments": "comment.",
            "credentials": "key.",
            "exceptions": "exception.",
        }[category]
        query = query.where(Notification.kind.startswith(prefix))
    return query


def notification_record(n, source, state):
    return {
        "id": n.id,
        "kind": n.kind,
        "resource_type": n.resource_type,
        "resource_id": n.resource_id,
        **target_record(n, source, state),
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
