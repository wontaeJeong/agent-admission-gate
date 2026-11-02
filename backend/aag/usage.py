"""Classify stored usage without rewriting historical records."""

from sqlalchemy import and_, or_
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError

from .models import Usage

MCP_HTTP_START_ID = "system:mcp-http-collection-start"


def ensure_mcp_http_start(session):
    """Persist one first-start marker even if startup races with another process."""
    dialect = session.get_bind().dialect.name
    if dialect in {"sqlite", "postgresql"}:
        insert = sqlite_insert if dialect == "sqlite" else postgres_insert
        session.execute(
            insert(Usage)
            .values(id=MCP_HTTP_START_ID, kind="mcp_http_start")
            .on_conflict_do_nothing(index_elements=["id"])
        )
    elif session.get(Usage, MCP_HTTP_START_ID) is None:
        try:
            with session.begin_nested():
                session.add(Usage(id=MCP_HTTP_START_ID, kind="mcp_http_start"))
                session.flush()
        except IntegrityError:
            pass


def legacy_mcp_tool_filter():
    # Before HTTP accounting, only some MCP tools wrote kind=api records.
    return and_(Usage.kind == "api", Usage.route.like("mcp:%"))


def rest_http_filter():
    return and_(
        Usage.kind == "api",
        or_(Usage.route.is_(None), ~Usage.route.like("mcp:%")),
    )


def http_request_filter():
    return or_(rest_http_filter(), Usage.kind == "mcp_http")


def usage_unit(row):
    if row.kind == "api":
        if row.route and row.route.startswith("mcp:"):
            return "mcp", "legacy_partial_tool_call"
        return "rest", "http_request"
    if row.kind == "mcp_http":
        return "mcp", "http_request"
    if row.kind == "llm":
        return "model", "model_request"
    return "other", "record"
