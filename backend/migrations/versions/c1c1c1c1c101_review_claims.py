"""review_claims: additive assignment and public workflow history.

Revision ID: c1c1c1c1c101
Revises: f1b1b1b1b101
"""

import sqlalchemy as sa
from alembic import op

revision = "c1c1c1c1c101"
down_revision = "f1b1b1b1b101"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("reviews") as batch:
        batch.add_column(sa.Column("assignee_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("claimed_at", sa.Float(), nullable=True))
        batch.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(
            sa.Column("workflow_state", sa.String(24), nullable=False, server_default="waiting")
        )
        batch.create_foreign_key("fk_reviews_assignee", "users", ["assignee_id"], ["id"])
    op.execute(
        "UPDATE reviews SET workflow_state = CASE WHEN status = 'pending' THEN 'waiting' ELSE 'closed' END"
    )
    op.create_index(
        "ix_reviews_queue", "reviews", ["status", "workflow_state", "assignee_id", "created_at"]
    )
    op.create_table(
        "review_events",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("review_id", sa.String(64), sa.ForeignKey("reviews.id"), nullable=False),
        sa.Column("actor_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("from_state", sa.String(24), nullable=False),
        sa.Column("to_state", sa.String(24), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("created_at", sa.Float(), nullable=False),
    )
    op.create_index("ix_review_events_order", "review_events", ["review_id", "created_at", "id"])


def downgrade():
    # Only unused schemas may go backwards. Production rollback disables new writes.
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM review_events")) or op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM reviews WHERE assignee_id IS NOT NULL OR revision <> 1 OR workflow_state NOT IN ('waiting','closed')"
        )
    ):
        raise RuntimeError(
            "Review workflow data exists; disable the feature and retain read-compatible schema"
        )
    op.drop_table("review_events")
    op.drop_index("ix_reviews_queue", table_name="reviews")
    with op.batch_alter_table("reviews") as batch:
        batch.drop_constraint("fk_reviews_assignee", type_="foreignkey")
        for name in ["workflow_state", "revision", "claimed_at", "assignee_id"]:
            batch.drop_column(name)
