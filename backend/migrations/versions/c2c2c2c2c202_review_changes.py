"""review_changes: withdrawal closure and workflow notification preferences."""

import sqlalchemy as sa
from alembic import op

revision = "c2c2c2c2c202"
down_revision = "c1c1c1c1c101"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("reviews") as batch:
        batch.add_column(sa.Column("closed_reason", sa.Text(), nullable=True))
    with op.batch_alter_table("notification_preferences") as batch:
        batch.add_column(
            sa.Column("review_updates", sa.Boolean(), nullable=False, server_default=sa.true())
        )


def downgrade():
    connection = op.get_bind()
    checks = [
        "SELECT count(*) FROM reviews WHERE closed_reason IS NOT NULL OR status = 'withdrawn' OR workflow_state = 'changes_requested'",
        "SELECT count(*) FROM review_events WHERE kind IN ('withdraw','request_changes','respond')",
        "SELECT count(*) FROM notifications WHERE kind IN ('review.claimed','review.released','review.changes_requested','review.responded','review.withdrawn')",
        "SELECT count(*) FROM notification_preferences WHERE review_updates = false",
    ]
    if any(connection.scalar(sa.text(query)) for query in checks):
        raise RuntimeError(
            "Review changes data exists; disable the feature and retain read-compatible schema"
        )
    with op.batch_alter_table("notification_preferences") as batch:
        batch.drop_column("review_updates")
    with op.batch_alter_table("reviews") as batch:
        batch.drop_column("closed_reason")
