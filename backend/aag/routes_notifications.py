import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from sqlalchemy import func, select, update

from .auth import Actor, actor
from .models import Job, Notification, NotificationInbox, NotificationPreference
from .notifications import (
    Category,
    State,
    conflict_insert,
    filtered_notifications,
    notification_record,
    preference_values,
    visible_notifications,
)

router = APIRouter(prefix="/api")


def notification_actor(request: Request, a: Actor = Depends(actor)):
    a.interactive()
    if request.headers.get("x-aag-account") != a.id:
        raise HTTPException(409, "Notification account changed; reload required")
    return a


class NonNullPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def non_null_changes(self):
        if not self.model_fields_set or any(
            getattr(self, field) is None for field in self.model_fields_set
        ):
            raise ValueError("Provide at least one boolean change; null is not supported")
        return self


class NotificationChange(NonNullPatch):
    read: StrictBool | None = None
    archived: StrictBool | None = None


class PreferenceChange(NonNullPatch):
    scans: StrictBool | None = None
    review_requests: StrictBool | None = None
    review_results: StrictBool | None = None
    review_updates: StrictBool | None = None
    comments: StrictBool | None = None


class MarkAll(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Category = "all"
    before: float = Field(ge=0, le=4102444800, allow_inf_nan=False)
    through: int = Field(ge=0, le=9223372036854775807, strict=True)


def unread_count(s, a, now, category="all", through=None):
    query = filtered_notifications(visible_notifications(a, now), "unread", category)
    if through is not None:
        query = query.where(Notification.sequence <= through)
    return s.scalar(select(func.count()).select_from(query.subquery()))


@router.get("/notifications/unread-count")
def count_notifications(request: Request, a: Actor = Depends(notification_actor)):
    a.interactive()
    with request.app.state.db.session() as s:
        return {"unread_count": unread_count(s, a, time.time())}


@router.get("/notifications")
def list_notifications(
    request: Request,
    state: State = "all",
    category: Category = "all",
    page: int = Query(1, ge=1, le=1_000_000),
    page_size: int = Query(25, ge=1, le=100),
    a: Actor = Depends(notification_actor),
):
    a.interactive()
    now = time.time()
    with request.app.state.db.session() as s:
        boundary = (
            s.scalar(select(NotificationInbox.sequence).where(NotificationInbox.user_id == a.id))
            or 0
        )
        query = filtered_notifications(visible_notifications(a, now), state, category).where(
            Notification.sequence <= boundary
        )
        total = s.scalar(select(func.count()).select_from(query.subquery()))
        rows = s.execute(
            query.add_columns(Job.source)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return {
            "items": [notification_record(n, source) for n, source in rows],
            "total": total,
            "unread_count": unread_count(s, a, now, through=boundary),
            "filtered_unread_count": unread_count(s, a, now, category, boundary),
            "snapshot_at": now,
            "snapshot_sequence": boundary,
        }


@router.post("/notifications/read-all")
def mark_all(data: MarkAll, request: Request, a: Actor = Depends(notification_actor)):
    a.interactive()
    now = time.time()
    query = filtered_notifications(visible_notifications(a, now), "unread", data.category).where(
        Notification.created_at <= min(data.before, now), Notification.sequence <= data.through
    )
    with request.app.state.db.session.begin() as s:
        changed = s.execute(
            update(Notification)
            .where(Notification.id.in_(query.with_only_columns(Notification.id)))
            .values(read_at=now)
        ).rowcount
        return {"updated": changed}


@router.patch("/notifications/{notification_id}")
def change_notification(
    notification_id: str,
    data: NotificationChange,
    request: Request,
    a: Actor = Depends(notification_actor),
):
    a.interactive()
    now = time.time()
    with request.app.state.db.session.begin() as s:
        row = s.execute(
            visible_notifications(a, now)
            .where(Notification.id == notification_id)
            .add_columns(Job.source)
        ).first()
        if row is None:
            raise HTTPException(404, "Notification not found")
        n, source = row
        if "read" in data.model_fields_set:
            n.read_at = (n.read_at or now) if data.read else None
        if "archived" in data.model_fields_set:
            n.archived_at = (n.archived_at or now) if data.archived else None
        return notification_record(n, source)


@router.get("/notification-preferences")
def get_preferences(request: Request, a: Actor = Depends(notification_actor)):
    a.interactive()
    with request.app.state.db.session() as s:
        return preference_values(s.get(NotificationPreference, a.id))


@router.put("/notification-preferences")
def put_preferences(
    data: PreferenceChange, request: Request, a: Actor = Depends(notification_actor)
):
    a.interactive()
    changes = data.model_dump(exclude_unset=True)
    with request.app.state.db.session.begin() as s:
        s.execute(
            conflict_insert(s, NotificationPreference)
            .values(user_id=a.id, **changes)
            .on_conflict_do_update(index_elements=["user_id"], set_=changes)
        )
        return preference_values(s.get(NotificationPreference, a.id))
