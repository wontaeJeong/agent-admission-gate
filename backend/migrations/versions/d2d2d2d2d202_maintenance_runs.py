"""Maintenance aggregates and exact expiration delivery snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "d2d2d2d2d202"
down_revision = "d1d1d1d1d101"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("notifications", sa.Column("expiry_snapshot", sa.Float(), nullable=True))
    op.create_index(
        "ix_notifications_expiration",
        "notifications",
        ["recipient_id", "resource_type", "resource_id", "kind", "expiry_snapshot"],
    )
    op.create_index("ix_api_keys_expiration", "api_keys", ["expires_at", "id"])
    op.create_index("ix_exceptions_expiration", "exceptions", ["expires_at", "id"])
    op.create_table(
        "maintenance_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("job_name", sa.String(64), nullable=False),
        sa.Column("started_at", sa.Float(), nullable=False),
        sa.Column("finished_at", sa.Float(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("scanned", sa.Integer(), nullable=False),
        sa.Column("emitted", sa.Integer(), nullable=False),
        sa.Column("skipped", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(40), nullable=True),
        sa.CheckConstraint("status IN ('running', 'success', 'failed')", name="maintenance_status"),
        sa.CheckConstraint(
            "scanned >= 0 AND emitted >= 0 AND skipped >= 0", name="maintenance_counts"
        ),
    )
    op.create_index(
        "ix_maintenance_runs_latest", "maintenance_runs", ["job_name", "started_at", "id"]
    )


def downgrade():
    bind = op.get_bind()
    if bind.scalar(sa.text("SELECT count(*) FROM maintenance_runs")) or bind.scalar(
        sa.text("SELECT count(*) FROM notifications WHERE expiry_snapshot IS NOT NULL")
    ):
        raise RuntimeError(
            "Disable detection and retain the read-compatible schema; history cannot be discarded."
        )
    op.drop_index("ix_notifications_expiration", table_name="notifications")
    op.drop_index("ix_api_keys_expiration", table_name="api_keys")
    op.drop_index("ix_exceptions_expiration", table_name="exceptions")
    op.drop_index("ix_maintenance_runs_latest", table_name="maintenance_runs")
    op.drop_table("maintenance_runs")
    with op.batch_alter_table("notifications") as batch:
        batch.drop_column("expiry_snapshot")
