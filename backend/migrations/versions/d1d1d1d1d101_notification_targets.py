"""notification_targets: preserve legacy inboxes and support non-scan resources."""

import sqlalchemy as sa
from alembic import op

revision = "d1d1d1d1d101"
down_revision = "e2e2e2e2e202"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("notifications", sa.Column("resource_type", sa.String(20), nullable=True))
    op.add_column("notifications", sa.Column("resource_id", sa.String(64), nullable=True))
    # Review events keep their existing review and job relationship. Comments
    # without a review remain scan targets, preserving the original destination.
    op.execute(
        sa.text(
            "UPDATE notifications SET resource_type = CASE WHEN review_id IS NOT NULL THEN 'review' ELSE 'scan' END, "
            "resource_id = CASE WHEN review_id IS NOT NULL THEN review_id ELSE job_id END"
        )
    )
    with op.batch_alter_table("notifications") as batch:
        batch.alter_column("resource_type", existing_type=sa.String(20), nullable=False)
        batch.alter_column("resource_id", existing_type=sa.String(64), nullable=False)
        batch.alter_column("job_id", existing_type=sa.String(64), nullable=True)
        batch.create_check_constraint(
            "ck_notification_target",
            "(resource_type = 'scan' AND job_id IS NOT NULL AND resource_id = job_id AND review_id IS NULL) OR "
            "(resource_type = 'review' AND job_id IS NOT NULL AND review_id IS NOT NULL AND resource_id = review_id) OR "
            "(resource_type IN ('api_key', 'exception') AND job_id IS NULL AND review_id IS NULL)",
        )
    for name in ("credentials", "exceptions"):
        op.add_column(
            "notification_preferences",
            sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade():
    if op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM notifications WHERE resource_type IN ('api_key', 'exception')"
        )
    ):
        raise RuntimeError(
            "Disable expiry detection and retain the read-compatible schema; typed notification history must not be deleted"
        )
    with op.batch_alter_table("notifications") as batch:
        batch.drop_constraint("ck_notification_target", type_="check")
        batch.alter_column("job_id", existing_type=sa.String(64), nullable=False)
        batch.drop_column("resource_type")
        batch.drop_column("resource_id")
    with op.batch_alter_table("notification_preferences") as batch:
        batch.drop_column("credentials")
        batch.drop_column("exceptions")
