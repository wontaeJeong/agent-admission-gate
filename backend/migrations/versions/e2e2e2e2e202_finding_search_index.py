"""finding_search_index: additive, rebuildable public search projection."""

import sqlalchemy as sa
from alembic import op

revision = "e2e2e2e2e202"
down_revision = "c3c3c3c3c303"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("jobs", sa.Column("finding_index_version", sa.Integer(), nullable=True))
    op.create_index("ix_jobs_search_order", "jobs", ["created_at", "id"])
    op.create_table(
        "finding_index",
        sa.Column(
            "job_id", sa.String(64), sa.ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("ordinal", sa.Integer(), primary_key=True),
        sa.Column("fingerprint", sa.String(128), nullable=False),
        *(
            sa.Column(k, sa.String(500), nullable=False)
            for k in ("engine", "rule", "severity", "title", "path", "action")
        ),
        sa.Column("line", sa.Integer(), nullable=True),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_finding_index_fingerprint", "finding_index", ["job_id", "fingerprint", "ordinal"]
    )
    op.create_index("ix_finding_index_rule", "finding_index", ["rule"])


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM jobs WHERE finding_index_version IS NOT NULL")
    ):
        raise RuntimeError(
            "Disable search and retain the read-compatible schema; rebuild projections forward"
        )
    op.drop_table("finding_index")
    op.drop_index("ix_jobs_search_order", table_name="jobs")
    with op.batch_alter_table("jobs") as batch:
        batch.drop_column("finding_index_version")
