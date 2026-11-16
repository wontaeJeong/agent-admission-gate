"""Add durable personal notification inbox and preferences.

Revision ID: ba4a1c83f990
Revises: 4dd3af4c1022
"""

import sqlalchemy as sa
from alembic import op

revision = "ba4a1c83f990"
down_revision = "4dd3af4c1022"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "notification_inboxes",
        sa.Column(
            "user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "notification_preferences",
        sa.Column(
            "user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("scans", sa.Boolean(), nullable=False),
        sa.Column("review_requests", sa.Boolean(), nullable=False),
        sa.Column("review_results", sa.Boolean(), nullable=False),
        sa.Column("comments", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "recipient_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_key", sa.String(180), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column(
            "job_id", sa.String(64), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "review_id",
            sa.String(64),
            sa.ForeignKey("reviews.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("verdict", sa.String(20), nullable=True),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("read_at", sa.Float(), nullable=True),
        sa.Column("archived_at", sa.Float(), nullable=True),
        sa.UniqueConstraint("recipient_id", "event_key", name="uq_notification_recipient_event"),
    )
    op.create_index(
        "ix_notifications_recipient_created", "notifications", ["recipient_id", "created_at", "id"]
    )
    op.create_index(
        "ix_notifications_recipient_state",
        "notifications",
        ["recipient_id", "archived_at", "read_at", "created_at"],
    )
    op.create_index("ix_notifications_created", "notifications", ["created_at"])
    op.create_index(
        "ix_notifications_recipient_sequence", "notifications", ["recipient_id", "sequence"]
    )


def downgrade():
    op.drop_table("notifications")
    op.drop_table("notification_preferences")
    op.drop_table("notification_inboxes")
