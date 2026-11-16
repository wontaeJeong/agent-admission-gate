"""session_return_target

Revision ID: d3222ac6ae74
Revises: ba4a1c83f990
Create Date: 2026-11-17 00:15:47.390855

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3222ac6ae74"
down_revision: Union[str, Sequence[str], None] = "ba4a1c83f990"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("oidc_states", sa.Column("return_to", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("oidc_states", "return_to")
