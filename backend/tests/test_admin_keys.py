import time

from aag.models import APIKey, User
from sqlalchemy import select


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
    first = client.get("/api/admin/api-keys").json()
    last = client.get("/api/admin/api-keys?page=26").json()
    assert first["total"] == 503
    assert len(first["items"]) == 20
    assert len(last["items"]) == 3
    assert (
        len(
            {
                row["id"]
                for page in range(1, 27)
                for row in client.get(f"/api/admin/api-keys?page={page}").json()["items"]
            }
        )
        == 503
    )
    assert "digest" not in first["items"][0]
    assert (
        client.get("/api/admin/api-keys", params={"q": "sYnThEtIc KeY 0500"}).json()["items"][0][
            "id"
        ]
        == "key-0500"
    )
    assert client.get("/api/admin/api-keys", params={"q": "%"}).json()["total"] == 0
    assert (
        client.get("/api/admin/api-keys", params={"state": "expired"}).json()["items"][0]["id"]
        == "expired"
    )
    assert (
        client.get("/api/admin/api-keys", params={"state": "revoked"}).json()["items"][0]["id"]
        == "revoked"
    )
    assert client.get("/api/admin/api-keys", params={"state": "active"}).json()["total"] == 501
    assert client.get("/api/admin/api-keys", params={"state": "unknown"}).status_code == 422
    assert (
        client.get("/api/admin/api-keys", params={"page": "999999999999999999999999"}).status_code
        == 422
    )


def test_admin_key_details_show_recorded_usage_and_key_audit_without_secrets(client, app):
    from aag.models import Audit, Usage

    created = client.post("/api/api-keys", json={"name": "Synthetic agent"}).json()
    other = client.post("/api/api-keys", json={"name": "Another agent"}).json()
    now = time.time()
    with app.state.db.session.begin() as s:
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
    assert data["usage"]["summary"]["requests_30d"] == 22
    assert data["usage"]["summary"]["active_days_30d"] == 22
    assert data["usage"]["summary"]["failures_30d"] == 11
    assert data["usage"]["summary"]["routes_30d"] == [{"route": "/api/scans", "count": 22}]
    assert data["usage"]["total"] == 24
    assert len(data["usage"]["items"]) == 20
    assert data["audit"]["total"] == 22
    assert len(data["audit"]["items"]) == 20
    assert any(
        item["reason"].startswith("Synthetic reason")
        for item in data["audit"]["items"]
        if item["reason"]
    )
    second = client.get(f"/api/admin/api-keys/{created['id']}?usage_page=2&audit_page=2").json()
    assert len(second["usage"]["items"]) == 4
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
    detail_response = client.get(path, headers=bearer)
    revoke_response = client.post(
        path + "/revoke", headers=bearer, json={"reason": "No longer used"}
    )
    assert list_response.status_code == 403
    assert detail_response.status_code == 403
    assert revoke_response.status_code == 403
    login(client, "alice")
    assert client.get("/api/admin/api-keys").status_code == 403
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
