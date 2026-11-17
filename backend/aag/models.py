import time
import uuid

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
    true,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid():
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    subject: Mapped[str] = mapped_column(String(256), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default="user")
    reviewer: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class UserProfile(Base):
    __tablename__ = "user_profiles"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    display_name: Mapped[str | None] = mapped_column(String(80))


class Session(Base):
    __tablename__ = "sessions"
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[float] = mapped_column(Float)


class APIKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    digest: Mapped[str] = mapped_column(String(64), unique=True)
    suffix: Mapped[str] = mapped_column(String(4))
    scopes: Mapped[list] = mapped_column(JSON, default=lambda: ["scan:read", "scan:write"])
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    expires_at: Mapped[float] = mapped_column(Float)
    revoked_at: Mapped[float | None] = mapped_column(Float)
    last_used_at: Mapped[float | None] = mapped_column(Float)


class DeviceClient(Base):
    __tablename__ = "device_clients"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class DeviceGrant(Base):
    __tablename__ = "device_grants"
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_code: Mapped[str] = mapped_column(String(8), unique=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("device_clients.id"))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    expires_at: Mapped[float] = mapped_column(Float)
    last_poll_at: Mapped[float] = mapped_column(Float, default=0)


class OIDCState(Base):
    __tablename__ = "oidc_states"
    return_to: Mapped[str | None] = mapped_column(String(2048))
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    verifier: Mapped[str] = mapped_column(String(100))
    nonce: Mapped[str] = mapped_column(String(100))
    expires_at: Mapped[float] = mapped_column(Float)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(20))
    ref: Mapped[str | None] = mapped_column(String(200))
    profile: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)
    verdict: Mapped[str | None] = mapped_column(String(20), index=True)
    effective_verdict: Mapped[str | None] = mapped_column(String(20))
    content_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    cache_key: Mapped[str | None] = mapped_column(String(64), index=True)
    cached_from: Mapped[str | None] = mapped_column(String(64))
    origin_job_id: Mapped[str | None] = mapped_column(String(64))
    lineage_root_id: Mapped[str | None] = mapped_column(String(64))
    target_commit: Mapped[str | None] = mapped_column(String(64))
    rerun_mode: Mapped[str | None] = mapped_column(String(20))
    resolved_commit: Mapped[str | None] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float, default=time.time, index=True)
    started_at: Mapped[float | None] = mapped_column(Float)
    completed_at: Mapped[float | None] = mapped_column(Float)
    __table_args__ = (
        Index("ix_jobs_owner_created", "owner_id", "created_at"),
        Index("ix_jobs_owner_root_created", "owner_id", "lineage_root_id", "created_at"),
    )


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), unique=True)
    requester_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    claimed_at: Mapped[float | None] = mapped_column(Float)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    workflow_state: Mapped[str] = mapped_column(
        String(24), default="waiting", server_default="waiting"
    )
    previous_review_id: Mapped[str | None] = mapped_column(ForeignKey("reviews.id"), unique=True)
    closed_reason: Mapped[str | None] = mapped_column(Text)
    decision_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    decided_at: Mapped[float | None] = mapped_column(Float)

    __table_args__ = (
        Index("ix_reviews_queue", "status", "workflow_state", "assignee_id", "created_at"),
    )


class ReviewEvent(Base):
    __tablename__ = "review_events"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    review_id: Mapped[str] = mapped_column(ForeignKey("reviews.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(32))
    from_state: Mapped[str] = mapped_column(String(24))
    to_state: Mapped[str] = mapped_column(String(24))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    __table_args__ = (Index("ix_review_events_order", "review_id", "created_at", "id"),)


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    target_type: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[str] = mapped_column(String(64), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    internal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    scans: Mapped[bool] = mapped_column(Boolean, default=True)
    review_requests: Mapped[bool] = mapped_column(Boolean, default=True)
    review_results: Mapped[bool] = mapped_column(Boolean, default=True)
    review_updates: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    comments: Mapped[bool] = mapped_column(Boolean, default=True)


class NotificationInbox(Base):
    __tablename__ = "notification_inboxes"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    sequence: Mapped[int] = mapped_column(BigInteger, default=0)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event_key: Mapped[str] = mapped_column(String(180))
    sequence: Mapped[int] = mapped_column(BigInteger, default=0)
    kind: Mapped[str] = mapped_column(String(40))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    review_id: Mapped[str | None] = mapped_column(ForeignKey("reviews.id", ondelete="CASCADE"))
    verdict: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    read_at: Mapped[float | None] = mapped_column(Float)
    archived_at: Mapped[float | None] = mapped_column(Float)
    __table_args__ = (
        UniqueConstraint("recipient_id", "event_key", name="uq_notification_recipient_event"),
        Index("ix_notifications_recipient_created", "recipient_id", "created_at", "id"),
        Index(
            "ix_notifications_recipient_state",
            "recipient_id",
            "archived_at",
            "read_at",
            "created_at",
        ),
        Index("ix_notifications_created", "created_at"),
        Index("ix_notifications_recipient_sequence", "recipient_id", "sequence"),
    )


class Post(Base):
    __tablename__ = "posts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(20), default="public")
    status: Mapped[str] = mapped_column(String(20), default="open")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    updated_at: Mapped[float] = mapped_column(Float, default=time.time)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class PostRead(Base):
    __tablename__ = "post_reads"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    post_id: Mapped[str] = mapped_column(ForeignKey("posts.id"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer)


class ExceptionRule(Base):
    __tablename__ = "exceptions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    fingerprint: Mapped[str] = mapped_column(String(64))
    content_hash: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[float] = mapped_column(Float)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Audit(Base):
    __tablename__ = "audit"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    actor_id: Mapped[str | None] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(80))
    target_id: Mapped[str] = mapped_column(String(256))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(Float, default=time.time, index=True)


class Usage(Base):
    __tablename__ = "usage"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    user_id: Mapped[str | None] = mapped_column(String(64), index=True)
    key_id: Mapped[str | None] = mapped_column(String(64), index=True)
    job_id: Mapped[str | None] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(20))
    provider: Mapped[str | None] = mapped_column(String(30))
    model: Mapped[str | None] = mapped_column(String(200))
    route: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[int] = mapped_column(Integer, default=200)
    latency_ms: Mapped[float] = mapped_column(Float, default=0)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer)
    cache_write_tokens: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[float | None] = mapped_column(Float)
    raw_usage: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(Float, default=time.time, index=True)


class SavedView(Base):
    __tablename__ = "saved_views"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    resource: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(40))
    filters: Mapped[dict] = mapped_column(JSON)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    updated_at: Mapped[float] = mapped_column(Float, default=time.time)
    __table_args__ = (
        UniqueConstraint("owner_id", "resource", "name", name="uq_saved_views_name"),
        Index(
            "uq_saved_views_default",
            "owner_id",
            "resource",
            unique=True,
            sqlite_where=text("is_default = 1"),
            postgresql_where=text("is_default = true"),
        ),
    )
