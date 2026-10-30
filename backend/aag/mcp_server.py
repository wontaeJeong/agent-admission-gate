import time

from fastapi import HTTPException
from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers
from sqlalchemy import select

from .auth import authenticate
from .db import record
from .models import Job, Usage
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

    def usage(a, route, status, start):
        with db.session.begin() as s:
            s.add(
                Usage(
                    user_id=a.id,
                    key_id=a.key_id,
                    kind="api",
                    route="mcp:" + route,
                    status=status,
                    latency_ms=(time.monotonic() - start) * 1000,
                )
            )

    @mcp.tool
    async def scan(
        url: str, profile: str = "static", ref: str | None = None, force_rescan: bool = False
    ) -> dict:
        """Submit an HTTPS Git package for asynchronous admission inspection."""
        a, start = current("scan:write"), time.monotonic()
        status = 202
        try:
            return await scans.submit(
                a, ScanRequest(url=url, profile=profile, ref=ref, force_rescan=force_rescan)
            )
        except HTTPException as e:
            status = e.status_code
            raise ValueError(e.detail) from e
        except Exception:
            status = 500
            raise
        finally:
            usage(a, "scan", status, start)

    @mcp.tool
    def get_scan(scan_id: str) -> dict:
        """Read your scan, engine coverage, findings, and admission verdict."""
        a, start = current("scan:read"), time.monotonic()
        status = 200
        try:
            with db.session() as s:
                return record(owned_job(s, scan_id, a))
        except HTTPException as e:
            status = e.status_code
            raise ValueError(e.detail) from e
        finally:
            usage(a, "get_scan", status, start)

    @mcp.tool
    def list_scans(limit: int = 20) -> list[dict]:
        """List only scans owned by the API key's user (maximum 100)."""
        a, start = current("scan:read"), time.monotonic()
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
        usage(a, "list_scans", 200, start)
        return result

    return mcp.http_app(path="/", stateless_http=True)
