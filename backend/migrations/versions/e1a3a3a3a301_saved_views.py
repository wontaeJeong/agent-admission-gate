"""saved_views

Revision ID: e1a3a3a3a301
Revises: d3222ac6ae74
"""

import sqlalchemy as sa
from alembic import op

revision = "e1a3a3a3a301"
down_revision = "d3222ac6ae74"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saved_views",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "owner_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("resource", sa.String(20), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.Float(), nullable=False),
        sa.UniqueConstraint("owner_id", "resource", "name", name="uq_saved_views_name"),
    )
    op.create_index("ix_saved_views_owner_id", "saved_views", ["owner_id"])
    op.create_index(
        "uq_saved_views_default",
        "saved_views",
        ["owner_id", "resource"],
        unique=True,
        sqlite_where=sa.text("is_default = 1"),
        postgresql_where=sa.text("is_default = true"),
    )


def downgrade():
    op.drop_table("saved_views")
