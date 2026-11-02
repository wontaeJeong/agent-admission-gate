import time

import pytest
from aag.auth import issue_key
from aag.models import Job, Review, User
from conftest import login


@pytest.fixture
def scoped_jobs(client, app, people):
    admin = client.get("/api/auth/me").json()["id"]
    cutoff = (int(time.time() // 86400) - 6) * 86400
    jobs = [
        ("admin-failed", admin, "FAILED", cutoff + 1, False),
        ("alice-reviewed-failed", people["alice"]["id"], "FAILED", cutoff + 2, True),
        ("bob-reviewed-completed", people["bob"]["id"], "COMPLETED", cutoff + 3, True),
        ("bob-unreviewed-failed", people["bob"]["id"], "FAILED", cutoff + 4, False),
        ("alice-old-failed", people["alice"]["id"], "FAILED", cutoff - 1, True),
    ]
    with app.state.db.session.begin() as s:
        for source, owner, status, created, reviewed in jobs:
            job = Job(
                owner_id=owner,
                source=source,
                source_type="git",
                profile="static",
                status=status,
                created_at=created,
            )
            s.add(job)
            s.flush()
            if reviewed:
                s.add(
                    Review(
                        job_id=job.id,
                        requester_id=owner,
                        reason="Please review",
                        status="approved" if status == "COMPLETED" else "pending",
                    )
                )
    return jobs


@pytest.mark.parametrize(
    ("actor_name", "scope", "expected"),
    [
        ("admin", "personal", {"admin-failed"}),
        ("admin", "all", {"admin-failed", "alice-reviewed-failed", "bob-unreviewed-failed"}),
        ("reviewer", "review", {"alice-reviewed-failed"}),
        ("alice", "personal", {"alice-reviewed-failed"}),
    ],
)
def test_failed_list_matches_dashboard_scope_and_window(
    client, people, scoped_jobs, actor_name, scope, expected
):
    login(client, actor_name)
    metrics = client.get(f"/api/metrics?days=7&scope={scope}").json()
    response = client.get(f"/api/scans?days=7&scope={scope}&status=FAILED")
    assert response.status_code == 200
    data = response.json()
    assert {item["source"] for item in data["items"]} == expected
    assert data["total"] == metrics["statuses"].get("FAILED", 0) == len(expected)
    all_scans = client.get(f"/api/scans?days=7&scope={scope}").json()
    assert all_scans["total"] == metrics["total_scans"]


def test_review_list_matches_all_reviewed_dashboard_scans_and_paginates(
    client, people, scoped_jobs
):
    login(client, "reviewer")
    metrics = client.get("/api/metrics?days=7&scope=review").json()
    first = client.get("/api/scans?days=7&scope=review&page_size=1&page=1").json()
    second = client.get("/api/scans?days=7&scope=review&page_size=1&page=2").json()
    assert first["total"] == second["total"] == metrics["total_scans"] == 2
    assert {first["items"][0]["source"], second["items"][0]["source"]} == {
        "alice-reviewed-failed",
        "bob-reviewed-completed",
    }
    assert client.get("/api/scans?scope=review&days=7&q=bob").json()["total"] == 1
    assert client.get("/api/scans?scope=review&days=7&status=COMPLETED").json()["total"] == 1


def test_scope_authorization_and_legacy_mine_filter(client, app, people, scoped_jobs):
    login(client, "alice")
    for scope in ("review", "all"):
        assert client.get(f"/api/scans?scope={scope}").status_code == 403
    assert client.get("/api/scans?scope=personal").json()["total"] == 2
    assert client.get("/api/scans").json()["total"] == 2
    for name in ("reviewer", "alice"):
        headers = {"Authorization": "Bearer " + people[name]["token"]}
        assert client.get("/api/scans?scope=all", headers=headers).status_code == 403
        assert client.get("/api/scans?scope=review", headers=headers).status_code == 403
        expected = 0 if name == "reviewer" else 2
        assert client.get("/api/scans?scope=personal", headers=headers).json()["total"] == expected
        assert client.get("/api/scans", headers=headers).json()["total"] == expected
    login(client, "reviewer")
    assert client.get("/api/scans?scope=all").json()["total"] == 5
    assert client.get("/api/scans?mine=true").json()["total"] == 0
    assert client.get("/api/scans?scope=review&mine=true").json()["total"] == 0
    login(client, "admin")
    admin_id = client.get("/api/auth/me").json()["id"]
    with app.state.db.session.begin() as s:
        admin = s.get(User, admin_id)
        admin.reviewer = False
        _, admin_token = issue_key(s, admin_id, "admin scope test")
    assert client.get("/api/scans?scope=review").status_code == 403
    assert client.get("/api/scans?scope=all").json()["total"] == 5
    headers = {"Authorization": "Bearer " + admin_token}
    assert client.get("/api/scans?scope=all", headers=headers).status_code == 403
    assert client.get("/api/scans?scope=review", headers=headers).status_code == 403
    assert client.get("/api/scans?scope=personal", headers=headers).json()["total"] == 1
    assert client.get("/api/scans?scope=unknown").status_code == 422
    assert client.get("/api/scans?days=8").status_code == 422
