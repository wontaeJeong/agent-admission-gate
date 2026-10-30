import json
import os
import time
from pathlib import Path

import httpx
import typer

app = typer.Typer(help="Agent Admission Gate REST client")


def client():
    token = os.environ.get("AAG_API_KEY", "")
    return httpx.Client(
        base_url=os.environ.get("AAG_URL", "http://localhost:8000").rstrip("/"),
        headers={"Authorization": "Bearer " + token},
        timeout=40,
        follow_redirects=False,
    )


def show(r):
    r.raise_for_status()
    typer.echo(json.dumps(r.json(), ensure_ascii=False, indent=2))


@app.command()
def scan(
    url: str,
    profile: str = "static",
    ref: str | None = None,
    wait: bool = False,
    force: bool = False,
):
    """Scan an HTTPS Git repository. Exit 2 for REVIEW/BLOCK, 1 for failure."""
    with client() as c:
        r = c.post(
            "/api/scans", json={"url": url, "profile": profile, "ref": ref, "force_rescan": force}
        )
        r.raise_for_status()
        result = r.json()
        while wait and result["status"] in {"PENDING", "RUNNING"}:
            time.sleep(2)
            r = c.get("/api/scans/" + result["id"])
            r.raise_for_status()
            result = r.json()
        typer.echo(json.dumps(result, ensure_ascii=False, indent=2))
        if wait and result["status"] != "COMPLETED":
            raise typer.Exit(1)
        if wait and result["effective_verdict"] != "ALLOW":
            raise typer.Exit(2)


@app.command()
def upload(path: Path, profile: str = "static"):
    with client() as c, path.open("rb") as f:
        show(
            c.post(
                "/api/scans/upload",
                files={"file": (path.name, f, "application/zip")},
                data={"profile": profile},
            )
        )


@app.command()
def get(scan_id: str):
    with client() as c:
        show(c.get("/api/scans/" + scan_id))


@app.command()
def device_login(client_id: str):
    """Print the issued token once; store it in your own secret manager."""
    with client() as c:
        r = c.post("/api/device/authorize", json={"client_id": client_id})
        r.raise_for_status()
        flow = r.json()
        typer.echo(f"Open {flow['verification_uri']} and enter {flow['user_code']}")
        deadline, interval = time.monotonic() + flow["expires_in"], flow["interval"]
        while time.monotonic() < deadline:
            time.sleep(interval)
            r = c.post(
                "/api/device/token",
                json={"client_id": client_id, "device_code": flow["device_code"]},
            )
            if r.status_code == 200:
                typer.echo(r.json()["access_token"])
                return
            error = r.json().get("error")
            if error == "slow_down":
                interval += 5
            elif error != "authorization_pending":
                raise typer.BadParameter(error or "Device authorization failed")
        raise typer.BadParameter("Authorization expired")


@app.command()
def create_local_user(username: str, reviewer: bool = False, admin: bool = False):
    """Create a development user with a prompted password; disabled in OIDC/stg/prod."""
    from sqlalchemy import select

    from .auth import password_hash
    from .config import get_settings
    from .db import Database, audit
    from .models import User

    settings = get_settings()
    if settings.auth_mode != "local" or settings.environment not in {"development", "test"}:
        raise typer.BadParameter("Local users are only supported in development")
    if not username.strip() or len(username) > 120:
        raise typer.BadParameter("Username must contain 1–120 characters")
    password = typer.prompt("Password", hide_input=True, confirmation_prompt=True)
    if len(password) < 12:
        raise typer.BadParameter("Password must contain at least 12 characters")
    db = Database(settings.database_url)
    db.create()
    with db.session.begin() as s:
        if s.scalar(select(User).where(User.subject == "local:" + username)):
            raise typer.BadParameter("User already exists")
        user = User(
            subject="local:" + username,
            name=username,
            role="admin" if admin else "user",
            reviewer=reviewer,
            password_hash=password_hash(password),
        )
        s.add(user)
        s.flush()
        audit(s, None, "user.local_create", user.id, role=user.role, reviewer=reviewer)
    typer.echo("Created " + username)
