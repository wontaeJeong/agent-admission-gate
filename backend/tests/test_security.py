import asyncio
import io
import stat
import zipfile

import pytest
from aag.config import Settings
from aag.policy import decide, finding
from aag.scanners import ScannerContractError, normalize
from aag.sources import SourceError, command, extract_zip, validate_git_url
from conftest import login, upload, wait_job


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ssh://github.com/o/r",
        "http://github.com/o/r",
        "https://github.com.evil.test/o/r",
        "https://user:secret@github.com/o/r",
        "https://github.com/o/r?secret=value",
        "https://github.com/o/../r",
        "https://127.0.0.1/o/r",
        "https://github.com:444/o/r",
    ],
)
def test_git_url_rejection(url):
    with pytest.raises((SourceError, ValueError)):
        validate_git_url(url, ["github.com"], resolve=False)


def test_dns_private_address_rejected(monkeypatch):
    monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 443))])
    with pytest.raises(SourceError):
        validate_git_url("https://github.com/o/r", ["github.com"])


@pytest.mark.parametrize(
    "path",
    ["../../outside", "/absolute", "dir/../../outside", "dir\\file", ".git/config", "C:/escape"],
)
def test_zip_traversal(path, tmp_path):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        z.writestr(path, "bad")
    with pytest.raises(SourceError):
        extract_zip(data.getvalue(), tmp_path, Settings())


def test_zip_symlink_and_limits(tmp_path):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        entry = zipfile.ZipInfo("link")
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        z.writestr(entry, "/etc/passwd")
    with pytest.raises(SourceError):
        extract_zip(data.getvalue(), tmp_path, Settings())
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        z.writestr("large", "a" * 100)
    with pytest.raises(SourceError):
        extract_zip(data.getvalue(), tmp_path, Settings(max_extracted_bytes=50))


async def test_subprocess_timeout_output_and_cancellation(tmp_path):
    import sys

    with pytest.raises(TimeoutError):
        await command(
            [sys.executable, "-c", "import time; time.sleep(30)"], cwd=tmp_path, timeout=0.1
        )
    with pytest.raises(SourceError):
        await command(
            [sys.executable, "-c", 'print("a"*10000)'], cwd=tmp_path, timeout=5, max_output=100
        )
    task = asyncio.create_task(
        command([sys.executable, "-c", "import time; time.sleep(30)"], cwd=tmp_path, timeout=40)
    )
    await asyncio.sleep(0.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def test_secret_validation_and_csrf(client):
    secret = "not-to-be-reflected-secret"
    r = client.post(
        "/api/scans", json={"url": "https://github.com/o/r", "profile": "bad", "credential": secret}
    )
    assert r.status_code == 422 and secret not in r.text
    assert (
        client.post(
            "/api/api-keys", headers={"Origin": "https://evil.test"}, json={"name": "bad"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/auth/login",
            headers={"Origin": "https://evil.test"},
            json={"username": "admin", "password": "test-password-long"},
        ).status_code
        == 403
    )
    assert client.get("/mcp/").status_code == 401


def test_board_visibility_xss_revision_and_feature_flag(client, people, app):
    login(client, "alice")
    body = {
        "kind": "voc",
        "title": "Private issue",
        "body": "<script>alert(1)</script>\n\n[link](javascript:alert(1))",
        "visibility": "private",
    }
    p = client.post("/api/boards", json=body).json()
    detail = client.get("/api/boards/" + p["id"]).json()
    assert "<script>" not in detail["body_html"]
    assert 'href="javascript:' not in detail["body_html"]
    assert client.post("/api/boards", json={**body, "kind": "notice"}).status_code == 403
    login(client, "bob")
    assert client.get("/api/boards/" + p["id"]).status_code == 404
    assert not client.get("/api/boards?kind=voc").json()["items"]
    assert (
        client.post("/api/boards/" + p["id"] + "/comments", json={"body": "leak"}).status_code
        == 404
    )
    login(client, "alice")
    assert client.put("/api/boards/" + p["id"], json={**body, "revision": 1}).status_code == 200
    assert client.put("/api/boards/" + p["id"], json={**body, "revision": 1}).status_code == 409
    app.state.settings.boards_enabled = False
    assert client.get("/api/boards").status_code == 404
    assert client.get("/api/boards/" + p["id"]).status_code == 404
    assert client.post("/api/boards", json=body).status_code == 404


def test_internal_comments_not_visible(client, people):
    login(client, "alice")
    jid = upload(client)
    wait_job(client, jid)
    assert (
        client.post(
            "/api/scans/" + jid + "/comments", json={"body": "secret", "internal": True}
        ).status_code
        == 403
    )
    login(client, "reviewer")
    assert (
        client.post(
            "/api/scans/" + jid + "/comments", json={"body": "staff evidence", "internal": True}
        ).status_code
        == 201
    )
    login(client, "alice")
    assert client.get("/api/scans/" + jid + "/comments").json() == []


def test_exception_scope_and_expiry(client):
    files = {"script.py": "import os\nos.system('echo hi')"}
    j = wait_job(client, upload(client, files))
    f = j["result"]["findings"][0]
    assert (
        client.post(
            "/api/admin/allowlist",
            json={
                "fingerprint": f["fingerprint"],
                "content_hash": j["content_hash"],
                "source": "wrong.zip",
                "reason": "Specific exception",
                "expires_at": __import__("time").time() + 3600,
            },
        ).status_code
        == 201
    )
    j2 = wait_job(client, upload(client, files))
    assert j2["verdict"] == "REVIEW"
    assert (
        client.post(
            "/api/admin/allowlist",
            json={
                "fingerprint": f["fingerprint"],
                "content_hash": j["content_hash"],
                "source": "package.zip",
                "reason": "Specific exception",
                "expires_at": __import__("time").time() + 3600,
            },
        ).status_code
        == 201
    )
    j3 = wait_job(client, upload(client, files))
    assert j3["verdict"] == "ALLOW" and j3["result"]["findings"][0]["suppressed"]


@pytest.mark.parametrize("engine", ["syft", "grype", "grant", "skill", "mcp", "osv"])
def test_unknown_scanner_schema_fails_closed(engine):
    with pytest.raises(ScannerContractError):
        normalize(engine, {})


def test_policy_missing_engine_and_llm_does_not_downgrade():
    assert decide([], [{"required": True, "status": "failed"}]) == "REVIEW"
    f = finding("test", "danger", "critical", "Danger")
    assert decide([f], [{"required": True, "status": "completed"}]) == "BLOCK"


def test_prod_settings_require_secure_oidc():
    with pytest.raises(ValueError):
        Settings(environment="prod")
