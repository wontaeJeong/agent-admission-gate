from typing import Literal

from pydantic import BaseModel, Field, SecretStr


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: SecretStr


class ScanRequest(BaseModel):
    url: str = Field(max_length=2048)
    ref: str | None = Field(default=None, max_length=200, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._/+-]*$")
    profile: Literal["static", "full"] = "static"
    force_rescan: bool = False
    credential: SecretStr | None = None


class KeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    days: int = Field(default=90, ge=1, le=90)
    scopes: list[Literal["scan:read", "scan:write"]] = Field(
        default=["scan:read", "scan:write"], min_length=1, max_length=2
    )


class NameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class DeviceAuthorize(BaseModel):
    client_id: str


class DevicePoll(DeviceAuthorize):
    device_code: SecretStr


class DeviceDecision(BaseModel):
    user_code: str = Field(pattern=r"^[A-Z2-9]{8}$")
    approve: bool


class Reason(BaseModel):
    reason: str = Field(min_length=5, max_length=4000)


class ReviewDecision(Reason):
    decision: Literal["approved", "rejected"]


class CommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=20000)
    internal: bool = False


class UserPatch(BaseModel):
    role: Literal["user", "admin"]
    reviewer: bool
    active: bool


class PostRequest(BaseModel):
    kind: Literal["notice", "voc", "internal"]
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=50000)
    visibility: Literal["public", "private"] = "public"
    status: Literal["draft", "open", "triaged", "planned", "in_progress", "resolved", "closed"] = (
        "open"
    )
    pinned: bool = False
    revision: int | None = None


class ExceptionRequest(Reason):
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    source: str = Field(max_length=2048)
    expires_at: float
