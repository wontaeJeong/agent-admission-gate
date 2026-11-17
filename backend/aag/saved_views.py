"""Personal, versioned filter presets. All writes serialize on the owner's row."""

import time
from typing import Literal

from fastapi import HTTPException
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from .models import SavedView, User

Resource = Literal["jobs", "reviews"]


class ViewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resource: Resource
    name: str
    filters: dict
    is_default: StrictBool = False

    @field_validator("name")
    @classmethod
    def name_valid(cls, value):
        value = value.strip()
        if not 1 <= len(value) <= 40 or not value.isprintable():
            raise ValueError("Name must be 1–40 printable characters")
        return value

    @model_validator(mode="after")
    def filters_valid(self):
        validate_filters(self.resource, self.filters)
        return self


class ViewPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt = Field(ge=1)
    name: str | None = None
    filters: dict | None = None
    is_default: StrictBool | None = None

    @field_validator("name")
    @classmethod
    def name_valid(cls, value):
        return ViewCreate.name_valid(value) if value is not None else value

    @model_validator(mode="after")
    def non_null(self):
        changes = self.model_fields_set - {"expected_revision"}
        if not changes or any(getattr(self, k) is None for k in changes):
            raise ValueError("Provide at least one non-null change")
        return self


class ViewDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt = Field(ge=1)


def validate_filters(resource, filters):
    allowed = (
        {"version", "scope", "days", "status", "verdict", "q", "mine"}
        if resource == "jobs"
        else {"version", "tab", "status"}
    )
    if set(filters) - allowed or type(filters.get("version")) is not int or filters["version"] != 1:
        raise ValueError("Unsupported filter schema or field")
    enums = (
        {
            "scope": {"personal", "review", "all"},
            "status": {"PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"},
            "verdict": {"ALLOW", "REVIEW", "BLOCK"},
            "mine": {"true", "false"},
        }
        if resource == "jobs"
        else {
            "tab": {"mine", "pending", "approved", "all"},
            "status": {"pending", "approved", "rejected"},
        }
    )
    for key, values in enums.items():
        if key in filters and (not isinstance(filters[key], str) or filters[key] not in values):
            raise ValueError("Unsupported filter value")
    if "days" in filters and (
        type(filters["days"]) is not int or filters["days"] not in {7, 14, 30, 90}
    ):
        raise ValueError("Unsupported date range")
    if "q" in filters and (not isinstance(filters["q"], str) or len(filters["q"]) > 200):
        raise ValueError("Search must contain at most 200 characters")


def invalid_reason(a, resource, filters):
    if resource == "jobs":
        if filters.get("scope") == "review" and not a.reviewer:
            return "검토자 자격이 필요합니다. 범위를 수정하세요. / Reviewer qualification required; edit scope."
        if filters.get("scope") == "all" and not a.staff:
            return "직원 권한이 필요합니다. 범위를 수정하세요. / Staff access required; edit scope."
    elif filters.get("tab", "mine") != "mine" and not a.staff:
        return "직원 권한이 필요합니다. 탭을 수정하세요. / Staff access required; edit tab."
    return None


def dto(a, view):
    reason = invalid_reason(a, view.resource, view.filters)
    return {
        "id": view.id,
        "resource": view.resource,
        "name": view.name,
        "filters": view.filters,
        "is_default": view.is_default,
        "revision": view.revision,
        "usable": reason is None,
        "invalid_reason": reason,
    }


def list_views(s, a, resource):
    return [
        dto(a, v)
        for v in s.scalars(
            select(SavedView)
            .where(SavedView.owner_id == a.id, SavedView.resource == resource)
            .order_by(SavedView.name, SavedView.id)
        )
    ]


def lock_owner(s, a):
    # A write (rather than SELECT FOR UPDATE) also serializes SQLite transactions
    # before their first read, avoiding a stale read-to-write snapshot upgrade.
    s.execute(update(User).where(User.id == a.id).values(id=User.id))


def displace_default(s, a, resource):
    s.execute(
        update(SavedView)
        .where(
            SavedView.owner_id == a.id,
            SavedView.resource == resource,
            SavedView.is_default.is_(True),
        )
        .values(is_default=False, revision=SavedView.revision + 1, updated_at=time.time())
    )


def create_view(s, a, data):
    lock_owner(s, a)
    count = s.scalar(select(func.count()).select_from(SavedView).where(SavedView.owner_id == a.id))
    if count >= 20:
        raise HTTPException(409, "Saved view limit reached (20)")
    if data.get("is_default"):
        displace_default(s, a, data["resource"])
    view = SavedView(owner_id=a.id, **data)
    s.add(view)
    flush_view(s)
    return dto(a, view)


def owned_view(s, a, view_id, expected_revision):
    view = s.scalar(select(SavedView).where(SavedView.id == view_id, SavedView.owner_id == a.id))
    if not view:
        raise HTTPException(404, "Saved view not found")
    if view.revision != expected_revision:
        raise HTTPException(409, "Saved view changed; reload and review before retrying")
    return view


def change_view(s, a, view_id, data):
    lock_owner(s, a)
    view = owned_view(s, a, view_id, data["expected_revision"])
    changes = {k: v for k, v in data.items() if k != "expected_revision"}
    if "filters" in changes:
        try:
            validate_filters(view.resource, changes["filters"])
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
    if changes.get("is_default") and not view.is_default:
        displace_default(s, a, view.resource)
    changed = s.execute(
        update(SavedView)
        .where(
            SavedView.id == view_id,
            SavedView.owner_id == a.id,
            SavedView.revision == data["expected_revision"],
        )
        .values(**changes, revision=SavedView.revision + 1, updated_at=time.time())
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "Saved view changed; reload required")
    flush_view(s)
    s.refresh(view)
    return dto(a, view)


def delete_view(s, a, view_id, expected_revision):
    lock_owner(s, a)
    view = owned_view(s, a, view_id, expected_revision)
    s.delete(view)
    s.flush()
    return {"deleted": True}


def flush_view(s):
    try:
        s.flush()
    except IntegrityError as e:
        raise HTTPException(409, "A view with this name already exists") from e
