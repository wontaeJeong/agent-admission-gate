import time

import pytest
from aag.models import Job, User
from conftest import login as session_login
from conftest import upload, wait_job
from sqlalchemy import select


def login(client, name):
    session_login(client, name)
    client.headers["X-AAG-Account"] = client.get("/api/auth/me").json()["id"]


def inbox(client, **params):
    response = client.get("/api/notifications", params=params)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def reviewable(app, people):
    with app.state.db.session.begin() as s:
        job = Job(
            owner_id=people["alice"]["id"],
            source="synthetic-package.zip",
            source_type="upload",
            profile="static",
            status="COMPLETED",
            verdict="REVIEW",
            effective_verdict="REVIEW",
            result={"coverage_complete": True},
        )
        s.add(job)
        s.flush()
        return job.id


def request_review(client, job_id):
    login(client, "alice")
    response = client.post(f"/api/scans/{job_id}/review", json={"reason": "Private review reason"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_scan_completion_and_cached_result_notify_owner_only(client, people):
    login(client, "alice")
    first = wait_job(client, upload(client))
    cached = wait_job(client, upload(client))
    assert cached["cached_from"] == first["id"]
    data = inbox(client)
    assert data["total"] == data["unread_count"] == 2
    assert {n["href"] for n in data["items"]} == {f"/jobs/{first['id']}", f"/jobs/{cached['id']}"}
    assert all(n["kind"] == "scan.completed" and n["verdict"] == "ALLOW" for n in data["items"])
    assert client.get("/api/notifications/unread-count").json() == {"unread_count": 2}
    login(client, "bob")
    assert inbox(client)["total"] == 0
    login(client, "admin")
    assert inbox(client)["total"] == 0


def test_failed_upload_notifies_without_copying_error(client, people):
    login(client, "alice")
    response = client.post(
        "/api/scans/upload", files={"file": ("private.zip", b"invalid zip", "application/zip")}
    )
    assert response.status_code == 202
    job = wait_job(client, response.json()["id"])
    assert job["status"] == "FAILED"
    notification = inbox(client)["items"][0]
    assert notification["kind"] == "scan.failed"
    assert "error" not in notification and "result" not in notification


def test_restart_and_repeated_terminal_calls_do_not_duplicate(client, app, people):
    login(client, "alice")
    with app.state.db.session.begin() as s:
        job = Job(
            owner_id=people["alice"]["id"],
            source="sample.zip",
            source_type="upload",
            profile="static",
        )
        s.add(job)
        s.flush()
        job_id = job.id
    app.state.scans.recover()
    app.state.scans.recover()
    app.state.scans.fail(job_id, "FAILED", "Sensitive scanner failure")
    data = inbox(client)
    assert data["total"] == 1
    assert data["items"][0]["kind"] == "scan.failed"


def test_cancel_is_idempotent_and_notifies(client, app, people):
    login(client, "alice")
    with app.state.db.session.begin() as s:
        job = Job(
            owner_id=people["alice"]["id"],
            source="sample.zip",
            source_type="upload",
            profile="static",
        )
        s.add(job)
        s.flush()
        job_id = job.id
    assert client.post(f"/api/scans/{job_id}/cancel").status_code == 200
    assert client.post(f"/api/scans/{job_id}/cancel").status_code == 409
    app.state.scans.fail(job_id, "CANCELLED", "Cancelled again")
    assert [n["kind"] for n in inbox(client)["items"]] == ["scan.cancelled"]


def test_review_audience_qualification_and_removed_privilege(client, app, people, reviewable):
    with app.state.db.session.begin() as s:
        admin = s.scalar(select(User).where(User.role == "admin"))
        admin.reviewer = False
        s.get(User, people["bob"]["id"]).active = False
        s.get(User, people["bob"]["id"]).reviewer = True
    review_id = request_review(client, reviewable)
    assert inbox(client)["total"] == 0
    login(client, "admin")
    assert inbox(client)["total"] == 0
    login(client, "reviewer")
    data = inbox(client)
    assert data["total"] == 1
    item = data["items"][0]
    assert item["href"] == f"/reviews/{review_id}" and item["kind"] == "review.requested"
    with app.state.db.session.begin() as s:
        s.get(User, people["reviewer"]["id"]).reviewer = False
    assert inbox(client)["total"] == 0
    assert client.get("/api/notifications/unread-count").json()["unread_count"] == 0
    assert client.patch(f"/api/notifications/{item['id']}", json={"read": True}).status_code == 404


@pytest.mark.parametrize("decision", ["approved", "rejected"])
def test_review_decision_notifies_requester_once(client, people, reviewable, decision):
    review_id = request_review(client, reviewable)
    login(client, "reviewer")
    body = {"decision": decision, "reason": "Sensitive decision reason"}
    assert client.post(f"/api/reviews/{review_id}/decision", json=body).status_code == 200
    assert client.post(f"/api/reviews/{review_id}/decision", json=body).status_code == 409
    login(client, "alice")
    data = inbox(client)
    assert data["total"] == 2
    assert {item["kind"] for item in data["items"]} == {"review.claimed", f"review.{decision}"}
    assert data["items"][0]["kind"] == f"review.{decision}"
    assert data["items"][0]["href"] == f"/reviews/{review_id}"
    assert "Sensitive decision reason" not in str(data)


def test_comments_exclude_self_and_internal_body(client, people, reviewable):
    login(client, "reviewer")
    for internal in (False, True):
        assert (
            client.post(
                f"/api/scans/{reviewable}/comments",
                json={"body": "Sensitive comment content", "internal": internal},
            ).status_code
            == 201
        )
    assert inbox(client)["total"] == 0
    login(client, "alice")
    data = inbox(client)
    assert data["total"] == 1 and data["items"][0]["kind"] == "comment.created"
    assert "Sensitive comment content" not in str(data)


def test_read_archive_restore_filters_and_ownership(client, people):
    login(client, "alice")
    wait_job(client, upload(client))
    item = inbox(client)["items"][0]
    path = f"/api/notifications/{item['id']}"
    for _ in range(2):
        assert client.patch(path, json={"read": True}).status_code == 200
    assert inbox(client, state="unread")["total"] == 0
    assert inbox(client)["unread_count"] == 0
    assert client.patch(path, json={"read": False}).status_code == 200
    assert inbox(client, state="unread")["total"] == 1
    assert client.patch(path, json={"archived": True}).status_code == 200
    assert inbox(client)["total"] == 0
    assert inbox(client, state="archived")["total"] == 1
    assert inbox(client)["unread_count"] == 0
    assert client.patch(path, json={"archived": False}).status_code == 200
    assert inbox(client)["unread_count"] == 1
    login(client, "bob")
    assert client.patch(path, json={"read": True}).status_code == 404
    login(client, "admin")
    assert client.patch(path, json={"read": True}).status_code == 404


def test_mark_all_has_filter_and_snapshot_boundaries(client, people, reviewable):
    login(client, "alice")
    wait_job(client, upload(client))
    snapshot = inbox(client)
    time.sleep(0.01)
    newer = wait_job(client, upload(client))
    login(client, "reviewer")
    client.post(f"/api/scans/{reviewable}/comments", json={"body": "A public update"})
    login(client, "alice")
    response = client.post(
        "/api/notifications/read-all",
        json={
            "category": "scans",
            "before": snapshot["snapshot_at"],
            "through": snapshot["snapshot_sequence"],
        },
    )
    assert response.status_code == 200 and response.json()["updated"] == 1
    remaining = inbox(client, state="unread")
    assert remaining["total"] == 2
    assert {n["kind"] for n in remaining["items"]} == {"scan.completed", "comment.created"}
    assert any(n["href"] == f"/jobs/{newer['id']}" for n in remaining["items"])
    assert inbox(client, category="comments")["total"] == 1


def test_preferences_persist_apply_to_future_only_and_reject_extra_fields(
    client, people, reviewable
):
    login(client, "alice")
    wait_job(client, upload(client))
    assert client.get("/api/notification-preferences").json() == {
        "scans": True,
        "review_requests": True,
        "review_results": True,
        "review_updates": True,
        "comments": True,
    }
    response = client.put("/api/notification-preferences", json={"scans": False})
    assert response.status_code == 200 and response.json()["scans"] is False
    wait_job(client, upload(client))
    assert inbox(client)["total"] == 1
    assert client.put("/api/notification-preferences", json={"email": True}).status_code == 422
    assert client.put("/api/notification-preferences", json={"scans": "false"}).status_code == 422
    login(client, "bob")
    assert client.get("/api/notification-preferences").json()["scans"] is True
    login(client, "alice")
    assert client.get("/api/notification-preferences").json()["scans"] is False


def test_session_only_csrf_and_input_bounds(client, people):
    login(client, "alice")
    for path in (
        "/api/notifications",
        "/api/notifications/unread-count",
        "/api/notification-preferences",
    ):
        response = client.get(path, headers={"Authorization": "Bearer " + people["alice"]["token"]})
        assert response.status_code == 403
    assert (
        client.post(
            "/api/notifications/read-all", json={}, headers={"Origin": "https://other.invalid"}
        ).status_code
        == 403
    )
    for query in (
        "page=0",
        "page=999999999999999999999999",
        "state=other",
        "category=other",
        "page_size=101",
    ):
        assert client.get("/api/notifications?" + query).status_code == 422
    assert client.post("/api/notifications/read-all", json={"before": 1e30}).status_code == 422
    assert client.patch("/api/notifications/missing", json={"read": None}).status_code == 422


def test_retention_pagination_and_prune(client, app, people, reviewable):
    from aag.models import Notification
    from aag.notifications import prune_notifications

    login(client, "alice")
    now = time.time()
    with app.state.db.session.begin() as s:
        for i in range(28):
            s.add(
                Notification(
                    recipient_id=people["alice"]["id"],
                    event_key=f"seed:{i}",
                    kind="scan.completed",
                    job_id=reviewable,
                    created_at=now - i,
                )
            )
        s.add(
            Notification(
                recipient_id=people["alice"]["id"],
                event_key="expired",
                kind="scan.failed",
                job_id=reviewable,
                created_at=now - 91 * 86400,
            )
        )
    first = inbox(client)
    second = inbox(client, page=2)
    assert first["total"] == first["unread_count"] == 28
    assert len(first["items"]) == 25 and len(second["items"]) == 3
    assert not {n["id"] for n in first["items"]} & {n["id"] for n in second["items"]}
    assert inbox(client, page=3)["items"] == []
    with app.state.db.session.begin() as s:
        assert prune_notifications(s, now=now) == 1


def test_emission_deduplicates_and_rollback_is_atomic(client, app, people, reviewable):
    from aag.models import Notification
    from aag.notifications import emit_notification

    with app.state.db.session.begin() as s:
        job = s.get(Job, reviewable)
        for _ in range(2):
            emit_notification(
                s, "scan.completed", job, [people["alice"]["id"]], "terminal:" + job.id
            )
    with pytest.raises(RuntimeError), app.state.db.session.begin() as s:
        emit_notification(
            s, "scan.failed", s.get(Job, reviewable), [people["alice"]["id"]], "rollback"
        )
        raise RuntimeError("Simulated business transaction failure")
    login(client, "alice")
    assert inbox(client)["total"] == 1
    with app.state.db.session() as s:
        assert len(list(s.scalars(select(Notification)))) == 1


def test_stale_account_binding_rejects_reads_and_writes(client, people):
    login(client, "alice")
    old_account = people["alice"]["id"]
    login(client, "bob")
    client.headers["X-AAG-Account"] = old_account
    for path in (
        "/api/notifications",
        "/api/notifications/unread-count",
        "/api/notification-preferences",
    ):
        assert client.get(path).status_code == 409
    assert client.put("/api/notification-preferences", json={"comments": False}).status_code == 409
    client.headers["X-AAG-Account"] = people["bob"]["id"]
    assert client.get("/api/notification-preferences").json()["comments"] is True


def test_mark_all_does_not_consume_delivery_uncommitted_at_snapshot(
    client, app, people, reviewable
):
    from types import SimpleNamespace

    from aag.auth import Actor
    from aag.notifications import emit_notification
    from aag.routes_notifications import list_notifications

    login(client, "alice")
    with app.state.db.session.begin() as s:
        emit_notification(
            s, "scan.completed", s.get(Job, reviewable), [people["alice"]["id"]], "committed"
        )
    with app.state.db.session() as writer:
        emit_notification(
            writer,
            "scan.completed",
            writer.get(Job, reviewable),
            [people["alice"]["id"]],
            "arriving",
        )
        writer.flush()
        # Read the route directly: HTTP usage middleware writes would otherwise
        # wait for the intentionally open writer and obscure the snapshot race.
        snapshot = list_notifications(
            SimpleNamespace(app=app),
            state="all",
            category="all",
            page=1,
            page_size=25,
            a=Actor(people["alice"]["id"], "alice", "user", False),
        )
        assert snapshot["total"] == 1
        writer.commit()
    body = {"before": snapshot["snapshot_at"]}
    if "snapshot_sequence" in snapshot:
        body["through"] = snapshot["snapshot_sequence"]
    response = client.post("/api/notifications/read-all", json=body)
    assert response.status_code == 200
    assert response.json()["updated"] == 1
    assert inbox(client)["unread_count"] == 1
