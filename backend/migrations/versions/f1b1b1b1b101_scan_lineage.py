"""scan_lineage

Revision ID: f1b1b1b1b101
Revises: e1a3a3a3a301
"""

import sqlalchemy as sa
from alembic import op

revision = "f1b1b1b1b101"
down_revision = "e1a3a3a3a301"
branch_labels = None
depends_on = None


def upgrade():
    for name, length in [
        ("origin_job_id", 64),
        ("lineage_root_id", 64),
        ("target_commit", 64),
        ("rerun_mode", 20),
    ]:
        op.add_column("jobs", sa.Column(name, sa.String(length), nullable=True))
    op.execute("UPDATE jobs SET lineage_root_id = id")
    op.create_index(
        "ix_jobs_owner_root_created", "jobs", ["owner_id", "lineage_root_id", "created_at"]
    )


def downgrade():
    op.drop_index("ix_jobs_owner_root_created", table_name="jobs")
    for name in ["rerun_mode", "target_commit", "lineage_root_id", "origin_job_id"]:
        op.drop_column("jobs", name)
