from fastapi import HTTPException
from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers
from sqlalchemy import select

from .auth import authenticate
from .db import record
from .models import Job
from .schemas import ScanRequest
from .service import owned_job


def build_mcp(db, settings, scans):
    mcp = FastMCP(
        "Agent Admission Gate",
        instructions="Inspect agent packages without executing submitted code. Admission reflects the selected profile and evidence, not a guarantee of safety.",
    )

    def current(scope):
        headers = get_http_headers(include={"authorization"})
        a = authenticate(db, settings, headers.get("authorization"))
        a.scope(scope)
        return a

    @mcp.tool
    async def scan(
        url: str, profile: str = "static", ref: str | None = None, force_rescan: bool = False
    ) -> dict:
        """Submit an HTTPS Git package for asynchronous admission inspection."""
        a = current("scan:write")
        try:
            return await scans.submit(
                a, ScanRequest(url=url, profile=profile, ref=ref, force_rescan=force_rescan)
            )
        except HTTPException as e:
            raise ValueError(e.detail) from e

    @mcp.tool
    def get_scan(scan_id: str) -> dict:
        """Read your scan, engine coverage, findings, and admission verdict."""
        a = current("scan:read")
        try:
            with db.session() as s:
                return record(owned_job(s, scan_id, a))
        except HTTPException as e:
            raise ValueError(e.detail) from e

    @mcp.tool
    def list_scans(limit: int = 20) -> list[dict]:
        """List only scans owned by the API key's user (maximum 100)."""
        a = current("scan:read")
        with db.session() as s:
            result = [
                record(j, ("result",))
                for j in s.scalars(
                    select(Job)
                    .where(Job.owner_id == a.id)
                    .order_by(Job.created_at.desc())
                    .limit(max(1, min(limit, 100)))
                )
            ]
        return result

    return mcp.http_app(path="/", stateless_http=True)
