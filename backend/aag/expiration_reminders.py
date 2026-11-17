"""Bounded operator-run detection. All public diagnostics contain aggregates only."""

import math
import time
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import and_, case, delete, literal, or_, select, text, union_all, update
from sqlalchemy.exc import SQLAlchemyError

from .models import (
    APIKey,
    ExceptionRule,
    MaintenanceRun,
    Notification,
    NotificationPreference,
    User,
    uid,
)
from .notifications import emit_resource_notification

DAY = 86400
JOB_NAME = "expiration_reminders"
SAFE_ERRORS = {"candidate_failed", "database_failed", "run_failed"}
Stage = Literal["7d", "1d", "expired"]


def due_stage(expires_at: float, now: float) -> Stage | None:
    remaining = expires_at - now
    if not math.isfinite(remaining) or remaining > 7 * DAY or remaining < -DAY:
        return None
    if remaining <= 0:
        return "expired"
    return "1d" if remaining <= DAY else "7d"


def database_now(db):
    # One database clock observation per detection run, shared by all stages/batches.
    with db.session() as s:
        sql = (
            "SELECT (julianday('now') - 2440587.5) * 86400.0"
            if db.engine.dialect.name == "sqlite"
            else "SELECT EXTRACT(EPOCH FROM clock_timestamp())"
        )
        return float(s.scalar(text(sql)))


@dataclass
class ReminderRunResult:
    started_at: float
    finished_at: float | None = None
    status: str = "running"
    scanned: int = 0
    emitted: int = 0
    skipped: int = 0
    error_code: str | None = None


def event_key(resource_type, resource_id, expires_at, stage):
    return f"expiry:{resource_type}:{resource_id}:{float(expires_at).hex()}:{stage}"


def _source(model, recipient, resource_type, prefix, preference, now):
    kind = case(
        (model.expires_at <= now, prefix + ".expired"),
        (model.expires_at <= now + DAY, prefix + ".expiring_1d"),
        else_=prefix + ".expiring_7d",
    )
    return (
        select(
            model.id.label("id"),
            model.expires_at.label("expires_at"),
            recipient.label("recipient_id"),
            literal(resource_type).label("resource_type"),
            kind.label("kind"),
        )
        .join(User, User.id == recipient)
        .outerjoin(NotificationPreference, NotificationPreference.user_id == User.id)
        .where(
            model.expires_at >= now - DAY,
            model.expires_at <= now + 7 * DAY,
            User.active.is_(True),
            APIKey.revoked_at.is_(None) if model is APIKey else ExceptionRule.active.is_(True),
            literal(True) if model is APIKey else User.role == "admin",
            or_(NotificationPreference.user_id.is_(None), preference.is_(True)),
            ~select(Notification.id)
            .where(
                Notification.recipient_id == recipient,
                Notification.resource_type == resource_type,
                Notification.resource_id == model.id,
                Notification.kind == kind,
                Notification.expiry_snapshot == model.expires_at,
            )
            .correlate(model)
            .exists(),
        )
    )


def _candidates(db, now, after, limit):
    candidates = union_all(
        _source(APIKey, APIKey.owner_id, "api_key", "key", NotificationPreference.credentials, now),
        _source(
            ExceptionRule,
            ExceptionRule.created_by,
            "exception",
            "exception",
            NotificationPreference.exceptions,
            now,
        ),
    ).subquery()
    query = select(candidates)
    if after is not None:
        expiry, ident, resource_type = after
        query = query.where(
            or_(
                candidates.c.expires_at > expiry,
                and_(candidates.c.expires_at == expiry, candidates.c.id > ident),
                and_(
                    candidates.c.expires_at == expiry,
                    candidates.c.id == ident,
                    candidates.c.resource_type > resource_type,
                ),
            )
        )
    with db.session() as s:
        return s.execute(
            query.order_by(
                candidates.c.expires_at, candidates.c.id, candidates.c.resource_type
            ).limit(limit)
        ).all()


def _deliver(s, candidate, now):
    # Same lock order as interactive producers: recipient User (non-key) before
    # target and Inbox. No identity network requests; request reads retain Actor ceilings.
    qualified = s.execute(
        update(User)
        .where(User.id == candidate.recipient_id, User.active.is_(True))
        .values(name=User.name)
        .returning(User.id)
    ).scalar_one_or_none()
    if qualified is None:
        return 0
    model = APIKey if candidate.resource_type == "api_key" else ExceptionRule
    target = s.scalar(select(model).where(model.id == candidate.id).with_for_update())
    if target is None or target.expires_at != candidate.expires_at:
        return 0
    stage = due_stage(target.expires_at, now)
    if stage is None:
        return 0
    if model is APIKey:
        if target.revoked_at is not None or target.owner_id != candidate.recipient_id:
            return 0
    elif not target.active or target.created_by != candidate.recipient_id:
        return 0
    # Lock an existing preference before checking it again in the shared producer.
    s.scalar(
        select(NotificationPreference)
        .where(NotificationPreference.user_id == candidate.recipient_id)
        .with_for_update()
    )
    return emit_resource_notification(
        s,
        candidate.kind,
        candidate.resource_type,
        candidate.id,
        [candidate.recipient_id],
        event_key(candidate.resource_type, candidate.id, target.expires_at, stage),
        expiry_snapshot=target.expires_at,
    )


def _progress(s, ident, result):
    s.execute(
        update(MaintenanceRun)
        .where(MaintenanceRun.id == ident)
        .values(
            scanned=result.scanned,
            emitted=result.emitted,
            skipped=result.skipped,
            status=result.status,
            finished_at=result.finished_at,
            error_code=result.error_code,
        )
    )


def emit_due_expirations(db, *, now=None, batch_size=500, max_batches=20, dry_run=False):
    """At most 10,000 shared candidates; each failure is retried by a later run.

    Candidate transactions are independent, so a failed item never rolls back
    committed notifications. Persistent failures remain visible as aggregate failure.
    The operator CLI owns flag enforcement. A dry-run performs SELECTs only.
    """
    if not 1 <= batch_size <= 500 or not 1 <= max_batches <= 20:
        raise ValueError("batch_size must be 1..500 and max_batches 1..20")
    started = time.monotonic()
    now = database_now(db) if now is None else now
    if not math.isfinite(now):
        raise ValueError("now must be finite")
    result = ReminderRunResult(started_at=now)
    ident = uid()
    if not dry_run:
        with db.session.begin() as s:
            old = (
                select(MaintenanceRun.id)
                .where(MaintenanceRun.started_at < now - 90 * DAY)
                .order_by(MaintenanceRun.started_at, MaintenanceRun.id)
                .limit(1000)
            )
            s.execute(delete(MaintenanceRun).where(MaintenanceRun.id.in_(old)))
            s.add(MaintenanceRun(id=ident, job_name=JOB_NAME, started_at=now, status="running"))
    try:
        after = None
        for _ in range(max_batches):
            rows = _candidates(db, now, after, batch_size)
            if not rows:
                break
            for candidate in rows:
                after = (candidate.expires_at, candidate.id, candidate.resource_type)
                if dry_run:
                    result.scanned += 1
                    continue
                prior_emitted = result.emitted
                prior_skipped = result.skipped
                result.scanned += 1
                try:
                    with db.session.begin() as s:
                        emitted = _deliver(s, candidate, now)
                        result.emitted += emitted
                        result.skipped += int(emitted == 0)
                        _progress(s, ident, result)
                except Exception:
                    # Rollback also removes any staged delivery/sequence allocation.
                    # No exception text, target identifiers, credentials or bodies.
                    result.emitted = prior_emitted
                    result.skipped = prior_skipped + 1
                    result.error_code = "candidate_failed"
                    with db.session.begin() as s:
                        _progress(s, ident, result)
            if len(rows) < batch_size:
                break
        result.status = "failed" if result.error_code else "success"
    except Exception as exc:
        result.status = "failed"
        result.error_code = "database_failed" if isinstance(exc, SQLAlchemyError) else "run_failed"
    # Completion follows elapsed monotonic time from the fixed database clock;
    # never resample wall time or move the detection window between batches.
    result.finished_at = now + (time.monotonic() - started)
    if not dry_run:
        with db.session.begin() as s:
            _progress(s, ident, result)
    return result


def operational_status(s, settings, now):
    latest = s.scalar(
        select(MaintenanceRun)
        .where(MaintenanceRun.job_name == JOB_NAME)
        .order_by(MaintenanceRun.started_at.desc(), MaintenanceRun.id.desc())
        .limit(1)
    )
    last_success = s.scalar(
        select(MaintenanceRun.finished_at)
        .where(
            MaintenanceRun.job_name == JOB_NAME,
            MaintenanceRun.status == "success",
            MaintenanceRun.finished_at <= now,
        )
        .order_by(MaintenanceRun.finished_at.desc())
        .limit(1)
    )
    activation = None
    configured = settings.expiry_reminders_enabled_at
    if configured is not None:
        try:
            activation = float(configured)
            if not math.isfinite(activation) or not 0 <= activation <= now:
                activation = None
        except (ValueError, TypeError):
            pass
    baseline = (
        max(activation, last_success or activation) if activation is not None else last_success
    )
    if not settings.expiry_reminders_enabled:
        state = "disabled"
    elif (configured is not None and activation is None) or baseline is None:
        state = "configuration_required"
    elif now - baseline >= 2 * 3600:
        state = "delayed"
    elif (
        latest and latest.started_at >= (activation or 0) and latest.status in {"failed", "running"}
    ):
        state = latest.status
    else:
        state = (
            "healthy"
            if last_success is not None and last_success >= (activation or 0)
            else "waiting"
        )
    return {
        "enabled": settings.expiry_reminders_enabled,
        "state": state,
        "enabled_at": activation,
        "last_success_at": last_success,
        "latest": None
        if latest is None
        else {
            "started_at": latest.started_at,
            "finished_at": latest.finished_at,
            "status": latest.status,
            "scanned": latest.scanned,
            "emitted": latest.emitted,
            "skipped": latest.skipped,
            "error_code": latest.error_code if latest.error_code in SAFE_ERRORS else None,
        },
    }
