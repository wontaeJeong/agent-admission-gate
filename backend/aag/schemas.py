from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictInt, model_validator


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: SecretStr


class ScanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin_job_id: str | None = Field(default=None, min_length=1, max_length=64)
    target_commit: str | None = Field(
        default=None, pattern=r"^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$"
    )
    rerun_mode: Literal["latest", "snapshot"] | None = None
    url: str = Field(max_length=2048)
    ref: str | None = Field(default=None, max_length=200, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._/+-]*$")
    profile: Literal["static", "full"] = "static"
    force_rescan: bool = False
    credential: SecretStr | None = None

    @model_validator(mode="after")
    def snapshot_contract(self):
        if self.target_commit:
            if self.ref or self.rerun_mode == "latest":
                raise ValueError("target_commit cannot be combined with ref or latest mode")
            self.target_commit = self.target_commit.lower()
            self.rerun_mode = "snapshot"
        elif self.rerun_mode == "snapshot":
            raise ValueError("snapshot requires target_commit")
        return self


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
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt | None = Field(default=None, ge=1)
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


class ReviewClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt = Field(ge=1)


class ReviewRelease(ReviewClaim):
    reason: str | None = Field(default=None, min_length=5, max_length=4000)


class ReviewChange(ReviewClaim):
    reason: str = Field(min_length=5, max_length=4000)

    @model_validator(mode="after")
    def meaningful_reason(self):
        if len(self.reason.strip()) < 5:
            raise ValueError("A reason of 5–4000 characters is required")
        return self
