import csv
import io
import time

from aag.models import Audit


def test_audit_export_includes_filtered_entries_as_safe_csv(app, client):
    with app.state.db.session.begin() as session:
        session.add_all(
            [
                Audit(action="export.test", target_id="=1+1", details={"reason": "checked"}),
                Audit(action="other.test", target_id="other", details={}),
            ]
        )
    response = client.get("/api/admin/audit/export", params={"action": "export.test"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 1
    assert rows[0]["action"] == "export.test"
    assert rows[0]["target_id"] == "'=1+1"
    assert '"reason": "checked"' in rows[0]["details"]


def test_audit_export_rejects_non_admin_and_api_keys(client, people):
    admin_key = client.post("/api/api-keys", json={"name": "admin export key"})
    assert admin_key.status_code == 201
    token = admin_key.json()["token"]
    response = client.get("/api/admin/audit/export", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    client.post("/api/auth/logout")
    assert (
        client.post(
            "/api/auth/login", json={"username": "alice", "password": "test-password-long"}
        ).status_code
        == 200
    )
    assert client.get("/api/admin/audit/export").status_code == 403


def test_audit_export_only_includes_requested_time_window(app, client):
    with app.state.db.session.begin() as session:
        session.add_all(
            [
                Audit(
                    action="window.test",
                    target_id="old",
                    details={},
                    created_at=time.time() - 8 * 86400,
                ),
                Audit(action="window.test", target_id="new", details={}, created_at=time.time()),
            ]
        )
    response = client.get("/api/admin/audit/export", params={"days": 7, "action": "window.test"})
    assert response.status_code == 200
    assert [row["target_id"] for row in csv.DictReader(io.StringIO(response.text))] == ["new"]
