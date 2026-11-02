import csv
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from aag.auth import issue_key
from aag.main import create_app
from aag.models import Usage
from conftest import login
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import delete, select


def test_mcp_scope_failure_is_an_http_200_not_a_successful_tool_metric(client, app, people):
    with app.state.db.session.begin() as s:
        _, token = issue_key(s, people["alice"]["id"], "read only", scopes=["scan:read"])
    response = client.post(
        "/mcp/",
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json, text/event-stream",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "scan", "arguments": {"url": "https://example.com/repo"}},
        },
    )
    assert response.status_code == 200
    payload = (
        json.loads(
            next(line[6:] for line in response.text.splitlines() if line.startswith("data: "))
        )
        if response.headers["content-type"].startswith("text/event-stream")
        else response.json()
    )
    assert payload["result"]["isError"]
    with app.state.db.session() as s:
        row = s.scalar(select(Usage).where(Usage.kind == "mcp_http"))
        assert row.status == 200
        assert row.user_id == people["alice"]["id"]
        assert not s.scalars(select(Usage).where(Usage.route.like("mcp:%"))).all()


def test_rest_http_usage_has_normalized_route_and_unattributed_auth_failure(client, app, people):
    secret = "private-scan-id-and-query"
    response = client.get(
        "/api/scans/" + secret + "?secret=" + secret,
        headers={"Authorization": "Bearer " + people["alice"]["token"]},
    )
    denied = client.get("/api/scans", headers={"Authorization": "Bearer bad-secret"})
    assert response.status_code == 404
    assert denied.status_code == 401
    with app.state.db.session() as s:
        rows = s.scalars(
            select(Usage).where(Usage.kind == "api").order_by(Usage.created_at.desc()).limit(2)
        ).all()
        assert [r.status for r in rows] == [401, 404]
        assert rows[0].user_id is None
        assert rows[1].user_id == people["alice"]["id"]
        assert secret not in repr([(r.route, r.raw_usage) for r in rows])


def test_mcp_http_usage_captures_protocol_responses_once_without_request_data(client, app, people):
    token = people["alice"]["token"]
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json, text/event-stream"}
    secret = "private-query-and-path-value"

    def rpc(method, params, ident):
        return client.post(
            "/mcp/?secret=" + secret,
            headers=headers,
            json={"jsonrpc": "2.0", "id": ident, "method": method, "params": params},
        )

    initialized = rpc(
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        },
        1,
    )
    listed = rpc("tools/list", {}, 2)
    called = rpc("tools/call", {"name": "list_scans", "arguments": {}}, 3)
    missing = client.get("/mcp/" + secret, headers=headers)
    denied = client.post("/mcp/", headers={"Authorization": "Bearer bad-secret"})
    oversized = client.post("/mcp/", headers={"content-length": "999999999"})
    assert [r.status_code for r in (initialized, listed, called, missing, denied, oversized)] == [
        200,
        200,
        200,
        404,
        401,
        413,
    ]

    with app.state.db.session() as s:
        rows = s.scalars(
            select(Usage).where(Usage.kind == "mcp_http").order_by(Usage.created_at)
        ).all()
        assert [r.status for r in rows] == [200, 200, 200, 404, 401, 413]
        assert [r.user_id for r in rows] == [people["alice"]["id"]] * 4 + [None, None]
        assert all(r.route == "/mcp" for r in rows)
        assert all(r.latency_ms >= 0 for r in rows)
        assert not s.scalars(select(Usage).where(Usage.route.like("mcp:%"))).all()
        assert secret not in repr([(r.route, r.raw_usage) for r in rows])
        assert token not in repr([(r.route, r.raw_usage) for r in rows])


def test_mcp_http_series_identifies_unobserved_history_and_partial_first_day(client, app):
    before = time.time()
    result = client.get("/api/metrics?days=7&scope=all").json()
    assert result["mcp_http_observed_since"] <= before
    assert all(day["mcp_http_requests"] is None for day in result["series"][:-1])
    assert result["series"][-1]["mcp_http_requests"] == 0
    assert result["series"][-1]["mcp_http_coverage"] == "partial"
    assert all(day["mcp_http_coverage"] == "unknown" for day in result["series"][:-1])
    exported = list(csv.DictReader(io.StringIO(client.get("/api/usage/export?scope=all").text)))
    assert all(row["kind"] != "mcp_http_start" for row in exported)
    with app.state.db.session() as s:
        assert len(s.scalars(select(Usage).where(Usage.kind == "mcp_http_start")).all()) == 1


def test_missing_mcp_collection_boundary_does_not_imply_zero_history(client, app):
    with app.state.db.session.begin() as s:
        s.execute(delete(Usage).where(Usage.kind == "mcp_http_start"))
    result = client.get("/api/metrics?scope=all").json()
    assert result["mcp_http_observed_since"] is None
    assert all(day["mcp_http_requests"] is None for day in result["series"])


def test_mcp_collection_boundary_survives_restart(app):
    with TestClient(app):
        with app.state.db.session() as s:
            started = s.scalar(select(Usage.created_at).where(Usage.kind == "mcp_http_start"))
    restarted = create_app(app.state.settings)
    with TestClient(restarted):
        with restarted.state.db.session() as s:
            starts = s.scalars(select(Usage.created_at).where(Usage.kind == "mcp_http_start")).all()
            assert starts == [started]


def test_concurrent_initialization_creates_one_collection_boundary(app):
    app.state.db.create()
    settings = app.state.settings.model_copy(update={"bootstrap_password": SecretStr("")})
    apps = [create_app(settings), create_app(settings)]
    barrier = Barrier(2)

    def start(application):
        barrier.wait()
        with TestClient(application) as client:
            assert client.get("/health/live").status_code == 200

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(start, apps))
    with app.state.db.session() as s:
        assert len(s.scalars(select(Usage).where(Usage.kind == "mcp_http_start")).all()) == 1


def test_metrics_and_csv_distinguish_http_from_legacy_tool_calls_and_enforce_scope(
    client, app, people
):
    yesterday = (int(time.time() // 86400) - 1) * 86400 + 1
    alice = people["alice"]["id"]
    bob = people["bob"]["id"]
    with app.state.db.session.begin() as s:
        marker = s.scalar(select(Usage).where(Usage.kind == "mcp_http_start"))
        marker.created_at = yesterday - 1
        s.add_all(
            [
                Usage(
                    user_id=alice,
                    kind="api",
                    route="/api/scans/{scan_id}",
                    status=200,
                    created_at=yesterday,
                ),
                Usage(
                    user_id=alice,
                    kind="api",
                    route="/api/scans/{scan_id}",
                    status=403,
                    created_at=yesterday,
                ),
                Usage(
                    user_id=alice, kind="mcp_http", route="/mcp", status=200, created_at=yesterday
                ),
                Usage(
                    user_id=alice, kind="mcp_http", route="/mcp", status=404, created_at=yesterday
                ),
                Usage(
                    user_id=alice,
                    kind="api",
                    route="mcp:get_scan",
                    status=404,
                    created_at=yesterday,
                ),
                Usage(user_id=bob, kind="mcp_http", route="/mcp", status=200, created_at=yesterday),
                Usage(
                    user_id=None, kind="mcp_http", route="/mcp", status=401, created_at=yesterday
                ),
            ]
        )

    login(client, "alice")
    mine = client.get("/api/metrics?days=7&scope=personal").json()
    assert mine["series"][-2]["rest_http_requests"] == 2
    assert mine["series"][-2]["mcp_http_requests"] == 2
    assert mine["series"][-2]["legacy_mcp_tool_calls"] == 1
    # Deprecated fields preserve the old kind=api unit and exclude new MCP HTTP rows.
    assert mine["series"][-2]["api_requests"] == 3
    assert mine["api"]["requests"] == mine["rest"]["requests"] + 1
    assert mine["api"]["errors"] == mine["rest"]["errors"] + 1
    assert set(mine["deprecated_fields"]) == {"api", "series.api_requests"}
    assert mine["series"][-3]["mcp_http_requests"] is None
    assert mine["series"][-2]["mcp_http_coverage"] == "partial"
    assert mine["series"][-1]["mcp_http_coverage"] == "possibly_partial"
    assert mine["mcp"] == {"requests": 2, "errors": 1, "latency_ms": 0.0}
    assert mine["legacy_mcp_tool_calls"] == 1
    assert client.get("/api/metrics?scope=all").status_code == 403
    assert client.get("/api/metrics?scope=review").status_code == 403

    exported = list(csv.DictReader(io.StringIO(client.get("/api/usage/export?days=7").text)))
    assert sum(r["protocol"] == "mcp" and r["unit"] == "http_request" for r in exported) == 2
    assert (
        sum(r["protocol"] == "mcp" and r["unit"] == "legacy_partial_tool_call" for r in exported)
        == 1
    )
    assert any(r["protocol"] == "rest" and r["unit"] == "http_request" for r in exported)
    assert all(r["status"] != "401" for r in exported)

    login(client, "reviewer")
    reviewed = client.get("/api/metrics?days=7&scope=review").json()
    assert reviewed["usage_scope"] == "personal"
    assert reviewed["series"][-2]["mcp_http_requests"] == 0
    assert reviewed["legacy_mcp_tool_calls"] == 0
    assert client.get("/api/usage/export?scope=all").status_code == 403

    login(client, "admin")
    everything = client.get("/api/metrics?days=7&scope=all").json()
    assert everything["series"][-2]["mcp_http_requests"] == 4
    assert everything["mcp"]["errors"] == 2
    assert everything["legacy_mcp_tool_calls"] == 1
    exported = list(
        csv.DictReader(io.StringIO(client.get("/api/usage/export?days=7&scope=all").text))
    )
    assert sum(r["protocol"] == "mcp" and r["unit"] == "http_request" for r in exported) == 4
    assert any(r["protocol"] == "mcp" and r["status"] == "401" for r in exported)
    assert (
        client.get(
            "/api/metrics?scope=all",
            headers={"Authorization": "Bearer " + people["alice"]["token"]},
        ).status_code
        == 403
    )


def test_key_usage_counts_http_requests_but_not_legacy_tool_events(client, app, people):
    token = people["alice"]["token"]
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json, text/event-stream"}
    client.post("/mcp/", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    with app.state.db.session.begin() as s:
        key_id = s.scalar(select(Usage.key_id).where(Usage.kind == "mcp_http"))
        s.add(
            Usage(user_id=people["alice"]["id"], key_id=key_id, kind="api", route="mcp:list_scans")
        )
    login(client, "alice")
    keys = client.get("/api/api-keys").json()
    assert keys[0]["requests_30d"] == 1
