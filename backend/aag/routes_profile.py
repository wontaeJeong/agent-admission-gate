from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy.exc import IntegrityError

from .auth import Actor, actor
from .db import audit
from .models import UserProfile

router = APIRouter(prefix="/api")


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value):
        if value is None:
            return None
        value = value.strip()
        if not value or len(value) > 80 or not value.isprintable():
            raise ValueError("Display name must be 1–80 printable characters")
        return value


def response(a, profile):
    return {
        "account_name": a.name,
        "display_name": profile.display_name if profile else None,
        "role": a.role,
        "reviewer": a.reviewer,
    }


@router.get("/profile")
def get_profile(request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session() as s:
        return response(a, s.get(UserProfile, a.id))


@router.put("/profile")
def update_profile(data: ProfileUpdate, request: Request, a: Actor = Depends(actor)):
    a.interactive()
    with request.app.state.db.session.begin() as s:
        profile = s.get(UserProfile, a.id)
        if not profile:
            try:
                with s.begin_nested():
                    profile = UserProfile(user_id=a.id, display_name=data.display_name)
                    s.add(profile)
                    s.flush()
            except IntegrityError:
                profile = s.get(UserProfile, a.id)
        profile.display_name = data.display_name
        audit(s, a.id, "profile.update", a.id)
        return response(a, profile)
