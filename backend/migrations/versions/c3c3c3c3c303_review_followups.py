"""review_followups: one content-scoped successor per review."""

import sqlalchemy as sa
from alembic import op

revision = "c3c3c3c3c303"
down_revision = "c2c2c2c2c202"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("reviews") as batch:
        batch.add_column(sa.Column("previous_review_id", sa.String(64), nullable=True))
        batch.create_foreign_key(
            "fk_reviews_previous_review", "reviews", ["previous_review_id"], ["id"]
        )
        batch.create_unique_constraint("uq_reviews_previous_review", ["previous_review_id"])


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM reviews WHERE previous_review_id IS NOT NULL")
    ):
        raise RuntimeError(
            "Follow-up history exists; disable the feature and retain read-compatible schema"
        )
    with op.batch_alter_table("reviews") as batch:
        batch.drop_constraint("uq_reviews_previous_review", type_="unique")
        batch.drop_constraint("fk_reviews_previous_review", type_="foreignkey")
        batch.drop_column("previous_review_id")
