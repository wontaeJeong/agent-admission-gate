"""Store optional user-controlled display names separately from identity.

Revision ID: 4dd3af4c1022
Revises: fc82ccf7d928
"""

import sqlalchemy as sa
from alembic import op

revision = "4dd3af4c1022"
down_revision = "fc82ccf7d928"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_profiles",
        sa.Column(
            "user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("display_name", sa.String(80), nullable=True),
    )


def downgrade():
    op.drop_table("user_profiles")
