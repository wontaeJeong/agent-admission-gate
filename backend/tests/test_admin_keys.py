import time

from aag.models import APIKey, User
from sqlalchemy import delete, select


def test_admin_key_listing_search_filter_and_all_pages(client, app):
    now = time.time()
    with app.state.db.session.begin() as s:
        admin = s.scalar(select(User).where(User.role == "admin"))
        s.add_all(
            [
                APIKey(
                    id=f"key-{i:04d}",
                    owner_id=admin.id,
                    name=f"Synthetic key {i:04d}",
                    digest=f"synthetic-digest-{i:04d}",
                    suffix=f"{i:04d}",
                    created_at=now + i / 1000,
                    expires_at=now + 3600,
                )
                for i in range(501)
            ]
        )
        s.add_all(
            [
                APIKey(
                    id="expired",
                    owner_id=admin.id,
                    name="Old agent",
                    digest="old-digest",
                    suffix="old1",
                    created_at=now,
                    expires_at=now - 1,
                ),
                APIKey(
                    id="revoked",
                    owner_id=admin.id,
                    name="Revoked agent",
                    digest="revoked-digest",
                    suffix="rev1",
                    created_at=now,
                    expires_at=now + 3600,
                    revoked_at=now,
                ),
            ]
        )
    legacy_response = client.get("/api/admin/api-keys")
    legacy_rows = legacy_response.json()
    assert isinstance(legacy_rows, list)
    assert len(legacy_rows) == 500
    assert legacy_response.headers["Deprecation"] == "true"
    assert legacy_response.headers["X-Total-Count"] == "503"
    assert legacy_response.headers["X-Result-Limit"] == "500"
    assert legacy_response.headers["X-Results-Truncated"] == "true"
    assert "requests_30d" in legacy_rows[0]
    assert "digest" not in legacy_rows[0]
    first = client.get("/api/admin/api-keys/search").json()
    last = client.get("/api/admin/api-keys/search?page=26").json()
    assert first["total"] == 503
    assert len(first["items"]) == 20
    assert len(last["items"]) == 3
    assert (
        len(
            {
                row["id"]
                for page in range(1, 27)
                for row in client.get(f"/api/admin/api-keys/search?page={page}").json()["items"]
            }
        )
        == 503
    )
    assert "digest" not in first["items"][0]
    assert (
        client.get("/api/admin/api-keys/search", params={"q": "sYnThEtIc KeY 0500"}).json()[
            "items"
        ][0]["id"]
        == "key-0500"
    )
    assert client.get("/api/admin/api-keys/search", params={"q": "%"}).json()["total"] == 0
    assert (
        client.get("/api/admin/api-keys/search", params={"state": "expired"}).json()["items"][0][
            "id"
        ]
        == "expired"
    )
    assert (
        client.get("/api/admin/api-keys/search", params={"state": "revoked"}).json()["items"][0][
            "id"
        ]
        == "revoked"
    )
    assert (
        client.get("/api/admin/api-keys/search", params={"state": "active"}).json()["total"] == 501
    )
    assert client.get("/api/admin/api-keys/search", params={"state": "unknown"}).status_code == 422
    assert (
        client.get(
            "/api/admin/api-keys/search", params={"page": "999999999999999999999999"}
        ).status_code
        == 422
    )


def test_admin_key_details_show_recorded_usage_and_key_audit_without_secrets(client, app):
    from aag.models import Audit, Usage

    created = client.post("/api/api-keys", json={"name": "Synthetic agent"}).json()
    other = client.post("/api/api-keys", json={"name": "Another agent"}).json()
    now = time.time()
    with app.state.db.session.begin() as s:
        s.execute(delete(Usage).where(Usage.kind == "mcp_http_start"))
        s.add_all(
            [
                Usage(
                    key_id=created["id"],
                    kind="api",
                    route="/api/scans",
                    status=200 if i % 2 else 403,
                    latency_ms=12,
                    created_at=now - i * 86400,
                    raw_usage={"secret": "never-return"},
                )
                for i in range(22)
            ]
            + [
                Usage(
                    key_id=created["id"],
                    kind="api",
                    route="mcp:list_scans",
                    status=200,
                    created_at=now - 31 * 86400,
                ),
                Usage(
                    key_id=created["id"],
                    kind="api",
                    route="future",
                    status=500,
                    created_at=now + 86400,
                ),
                Usage(
                    key_id=created["id"], kind="mcp_http", route="/mcp", status=503, created_at=now
                ),
                Usage(
                    key_id=created["id"], kind="api", route="mcp:scan", status=200, created_at=now
                ),
                Usage(
                    id="system:mcp-http-collection-start",
                    kind="mcp_http_start",
                    user_id=None,
                    key_id=None,
                    created_at=now - 5 * 86400,
                ),
                Usage(key_id=other["id"], kind="api", route="other", status=200, created_at=now),
                Usage(
                    key_id=created["id"], kind="llm", route="not-a-call", status=200, created_at=now
                ),
            ]
        )
        s.add_all(
            Audit(
                action="key.admin_revoke",
                target_id=created["id"],
                details={"reason": f"Synthetic reason {i}", "secret": "never-return"},
                created_at=now - i,
            )
            for i in range(21)
        )
        s.add(
            Audit(action="unrelated", target_id=created["id"], details={"secret": "never-return"})
        )
    response = client.get(f"/api/admin/api-keys/{created['id']}")
    assert response.status_code == 200
    exposes_token = created["token"] in response.text
    assert not exposes_token
    assert "never-return" not in response.text
    data = response.json()
    assert data["key"]["id"] == created["id"]
    assert "digest" not in data["key"]
    summary = data["usage"]["summary"]
    assert summary["rest_http"] == {"requests_30d": 22, "active_days_30d": 22, "errors_30d": 11}
    assert summary["mcp_http"]["observed_requests_30d"] == 1
    assert summary["mcp_http"]["transport_errors_30d"] == 1
    assert summary["mcp_http"]["coverage"] == "partial"
    assert summary["mcp_http"]["collection_started_at"] == now - 5 * 86400
    assert summary["legacy_mcp_tool"]["events_30d"] == 1
    legacy_response = client.get("/api/admin/api-keys")
    assert legacy_response.headers["X-Results-Truncated"] == "false"
    legacy_rows = legacy_response.json()
    legacy_key = next(row for row in legacy_rows if row["id"] == created["id"])
    assert legacy_key["requests_30d"] == 23
    assert legacy_key["mcp_http_coverage_30d"]["coverage"] == "partial"
    assert {item["unit"] for item in summary["routes_30d"]} == {
        "rest_http",
        "mcp_http",
        "legacy_mcp_tool",
    }
    assert data["usage"]["total"] == 26
    assert len(data["usage"]["items"]) == 20
    assert {item["unit"] for item in data["usage"]["items"]} == {
        "rest_http",
        "mcp_http",
        "legacy_mcp_tool",
    }
    assert data["audit"]["total"] == 22
    assert len(data["audit"]["items"]) == 20
    assert any(
        item["reason"].startswith("Synthetic reason")
        for item in data["audit"]["items"]
        if item["reason"]
    )
    second = client.get(f"/api/admin/api-keys/{created['id']}?usage_page=2&audit_page=2").json()
    assert len(second["usage"]["items"]) == 6
    assert len(second["audit"]["items"]) == 2
    assert client.get("/api/admin/api-keys/missing").status_code == 404
    invalid_page = client.get(
        f"/api/admin/api-keys/{created['id']}", params={"usage_page": "999999999999999999999999"}
    )
    assert invalid_page.status_code == 422


def test_admin_key_routes_require_interactive_admin_and_revoke_with_reason(client, app):
    from aag.auth import password_hash
    from aag.models import Audit
    from conftest import login

    with app.state.db.session.begin() as s:
        s.add(
            User(
                subject="local:alice",
                name="alice",
                role="user",
                password_hash=password_hash("test-password-long"),
            )
        )
    created = client.post("/api/api-keys", json={"name": "Synthetic agent"}).json()
    path = f"/api/admin/api-keys/{created['id']}"
    bearer = {"Authorization": "Bearer " + created["token"]}
    list_response = client.get("/api/admin/api-keys", headers=bearer)
    search_response = client.get("/api/admin/api-keys/search", headers=bearer)
    detail_response = client.get(path, headers=bearer)
    revoke_response = client.post(
        path + "/revoke", headers=bearer, json={"reason": "No longer used"}
    )
    assert list_response.status_code == 403
    assert search_response.status_code == 403
    assert detail_response.status_code == 403
    assert revoke_response.status_code == 403
    login(client, "alice")
    assert client.get("/api/admin/api-keys").status_code == 403
    assert client.get("/api/admin/api-keys/search").status_code == 403
    assert client.get(path).status_code == 403
    assert client.post(path + "/revoke", json={"reason": "No longer used"}).status_code == 403
    login(client, "admin")
    assert client.post(path + "/revoke", json={"reason": "no"}).status_code == 422
    assert client.post(path + "/revoke", json={"reason": "     "}).status_code == 422
    assert client.post(path + "/revoke", json={"reason": "No longer used"}).status_code == 200
    assert client.post(path + "/revoke", json={"reason": "Repeated request"}).status_code == 200
    denied_response = client.get("/api/scans", headers=bearer)
    assert denied_response.status_code == 401
    audit = client.get(path).json()["audit"]["items"]
    assert any(
        item["action"] == "key.admin_revoke" and item["reason"] == "No longer used"
        for item in audit
    )
    with app.state.db.session() as s:
        assert (
            len(
                s.scalars(
                    select(Audit).where(
                        Audit.target_id == created["id"], Audit.action == "key.admin_revoke"
                    )
                ).all()
            )
            == 1
        )


def test_mcp_collection_coverage_unknown_without_marker_and_possibly_partial_with_old_marker(
    client, app
):
    from aag.models import Usage

    created = client.post("/api/api-keys", json={"name": "Coverage test"}).json()
    with app.state.db.session.begin() as s:
        s.execute(delete(Usage).where(Usage.kind == "mcp_http_start"))
    path = f"/api/admin/api-keys/{created['id']}"
    missing = client.get(path).json()["usage"]["summary"]["mcp_http"]
    assert missing["coverage"] == "unknown"
    assert missing["collection_started_at"] is None
    assert missing["observed_requests_30d"] == 0
    with app.state.db.session.begin() as s:
        s.add(
            Usage(
                id="system:mcp-http-collection-start",
                kind="mcp_http_start",
                user_id=None,
                key_id=None,
                created_at=time.time() - 31 * 86400,
            )
        )
    observed = client.get(path).json()["usage"]["summary"]["mcp_http"]
    assert observed["coverage"] == "possibly_partial"


def test_admin_detail_reports_real_mcp_http_when_instrumented(client):
    import importlib.util

    import pytest

    if importlib.util.find_spec("aag.usage") is None:
        pytest.skip("MCP HTTP instrumentation is not installed")
    created = client.post("/api/api-keys", json={"name": "Integration agent"}).json()
    headers = {
        "Authorization": "Bearer " + created["token"],
        "Accept": "application/json, text/event-stream",
    }
    call = client.post(
        "/mcp/", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    )
    assert call.status_code == 200
    response = client.get("/api/admin/api-keys/" + created["id"])
    assert response.status_code == 200
    exposes_token = created["token"] in response.text
    assert not exposes_token
    usage = response.json()["usage"]
    assert usage["summary"]["mcp_http"]["observed_requests_30d"] == 1
    assert usage["summary"]["mcp_http"]["coverage"] == "partial"
    assert usage["summary"]["rest_http"]["requests_30d"] == 0
    assert usage["summary"]["legacy_mcp_tool"]["events_30d"] == 0
    assert usage["total"] == 1
    assert usage["items"][0]["unit"] == "mcp_http"
    assert usage["items"][0]["route"] == "/mcp"
    rows = client.get("/api/admin/api-keys").json()
    assert next(row for row in rows if row["id"] == created["id"])["requests_30d"] == 1
