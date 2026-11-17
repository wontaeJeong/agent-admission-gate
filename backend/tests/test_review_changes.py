"""C2 HTTP transitions, immutable scan results and atomic workflow delivery."""

import copy
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from aag.models import Audit, Job, Notification, NotificationInbox, Review, ReviewEvent, User
from sqlalchemy import select, text
from test_review_claims import workflow as workflow


def snapshot(app):
    with app.state.db.session() as s:
        j = s.get(Job, "job")
        return copy.deepcopy((j.verdict, j.effective_verdict, j.result, j.content_hash))


def changes(call):
    assert call("one", "claim").status_code == 200
    response = call("one", "request-changes", 2, reason="Please explain the evidence")
    assert response.status_code == 200
    return response.json()


def test_requester_withdraws_pending_without_changing_verdict(workflow):
    app, _, call = workflow
    before = snapshot(app)
    assert call("other", "withdraw", reason="Wrong requester").status_code == 404
    assert call("one", "withdraw", reason="Wrong requester").status_code == 403
    r = call("owner", "withdraw", reason="Request no longer needed")
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["workflow_state"], r.json()["closed_reason"]) == (
        "withdrawn",
        "closed",
        "Request no longer needed",
    )
    assert snapshot(app) == before


def test_cannot_withdraw_decided(workflow):
    app, _, call = workflow
    assert (
        call("one", "decision", decision="approved", reason="Evidence complete").status_code == 200
    )
    before = snapshot(app)
    assert call("owner", "withdraw", 2, reason="Cannot cancel approval").status_code == 409
    assert snapshot(app) == before


def test_only_assignee_requests_changes(workflow):
    app, _, call = workflow
    before = snapshot(app)
    assert call("one", "claim").status_code == 200
    assert call("two", "request-changes", 2, reason="Not assigned reviewer").status_code == 403
    assert call("one", "request-changes", 2, reason="Explain this evidence").status_code == 200
    assert snapshot(app) == before


def test_legacy_decision_cannot_bypass_changes(workflow):
    app, client, call = workflow
    before = snapshot(app)
    changes(call)
    app.state.settings.review_workflow_enabled = False
    response = client.post(
        "/api/reviews/review/decision",
        headers={"Origin": "http://localhost:8000", "Cookie": "aag_session=one"},
        json={"decision": "approved", "reason": "Cannot skip response"},
    )
    assert response.status_code == 409
    assert snapshot(app) == before
    assert call("owner", "respond", 3, reason="Explanation provided").status_code == 404


def test_stale_release_keeps_changes_requested(workflow):
    app, _, call = workflow
    before = snapshot(app)
    changes(call)
    with app.state.db.session.begin() as s:
        s.get(User, "one").reviewer = False
    r = call("two", "release", 3, reason="Reviewer lost qualification")
    assert r.status_code == 200
    assert r.json()["workflow_state"] == "changes_requested"
    assert call("two", "claim", 4).status_code == 409
    r = call("owner", "respond", 4, reason="Supplementary explanation")
    assert r.status_code == 200
    assert (r.json()["workflow_state"], r.json()["assignee_id"]) == ("waiting", None)
    assert snapshot(app) == before


@pytest.mark.parametrize("stale", [False, True])
def test_respond_restores_current_assignee(workflow, stale):
    app, _, call = workflow
    before = snapshot(app)
    changes(call)
    assert call("two", "respond", 3, reason="Not the requester").status_code == 403
    if stale:
        with app.state.db.session.begin() as s:
            s.get(User, "one").active = False
    r = call("owner", "respond", 3, reason="Supplementary explanation")
    assert r.status_code == 200
    assert (r.json()["workflow_state"], r.json()["assignee_id"]) == (
        ("waiting", None) if stale else ("in_review", "one")
    )
    assert snapshot(app) == before


@pytest.mark.parametrize("action", ["withdraw", "request-changes", "respond"])
def test_strict_input_account_and_api_key_ceiling(workflow, action):
    from aag.auth import issue_key

    app, client, call = workflow
    for fields in [
        {"reason": "short"},
        {"expected_revision": True, "reason": "Long reason"},
        {"expected_revision": 1, "reason": "     "},
        {"expected_revision": 1, "reason": "Long reason", "unknown": True},
    ]:
        response = client.post(
            "/api/reviews/review/" + action,
            headers={
                "Origin": "http://localhost:8000",
                "Cookie": "aag_session=owner",
                "X-AAG-Account": "owner",
            },
            json=fields,
        )
        assert response.status_code == 422
    assert (
        client.post(
            "/api/reviews/review/" + action,
            headers={"Origin": "http://localhost:8000", "Cookie": "aag_session=owner"},
            json={"expected_revision": 1, "reason": "Long reason"},
        ).status_code
        == 409
    )
    with app.state.db.session.begin() as s:
        _, token = issue_key(s, "owner", "synthetic")
    assert (
        client.post(
            "/api/reviews/review/" + action,
            headers={"Authorization": "Bearer " + token, "X-AAG-Account": "owner"},
            json={"expected_revision": 1, "reason": "Long reason"},
        ).status_code
        == 403
    )


def test_delivery_preferences_authorization_and_no_reason_copy(workflow):
    app, client, call = workflow
    changes(call)
    assert call("owner", "respond", 3, reason="Private explanatory text").status_code == 200
    assert call("owner", "withdraw", 4, reason="Private withdrawal text").status_code == 200
    with app.state.db.session() as s:
        rows = list(s.scalars(select(Notification).order_by(Notification.sequence)))
        assert {(n.kind, n.recipient_id) for n in rows} == {
            ("review.claimed", "owner"),
            ("review.changes_requested", "owner"),
            ("review.responded", "one"),
            ("review.withdrawn", "one"),
        }
        assert all("Private" not in str(n.__dict__) for n in rows)
    with app.state.db.session.begin() as s:
        s.get(User, "one").reviewer = False
    headers = {"Cookie": "aag_session=one", "X-AAG-Account": "one"}
    assert client.get("/api/notifications", headers=headers).json()["total"] == 0


def test_review_updates_opt_out_and_null_rejected(workflow):
    app, client, call = workflow
    headers = {
        "Origin": "http://localhost:8000",
        "Cookie": "aag_session=owner",
        "X-AAG-Account": "owner",
    }
    assert (
        client.put(
            "/api/notification-preferences", headers=headers, json={"review_updates": None}
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/notification-preferences", headers=headers, json={"review_updates": False}
        ).status_code
        == 200
    )
    changes(call)
    with app.state.db.session() as s:
        assert list(s.scalars(select(Notification))) == []


def test_notification_failure_rolls_back_everything(workflow, monkeypatch):
    from aag import review_workflow

    app, _, call = workflow
    original = review_workflow.emit_notification

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("synthetic delivery failure")

    monkeypatch.setattr(review_workflow, "emit_notification", fail)
    with pytest.raises(RuntimeError, match="synthetic delivery failure"):
        call("one", "claim")
    with app.state.db.session() as s:
        assert s.get(Review, "review").revision == 1
        for model in [ReviewEvent, Audit, Notification, NotificationInbox]:
            assert list(s.scalars(select(model))) == []


@pytest.mark.parametrize("pair", ["decision-withdraw", "respond-withdraw", "respond-respond"])
def test_concurrent_transitions_have_one_winner(workflow, pair):
    app, _, call = workflow
    if pair.startswith("respond"):
        changes(call)
        revision = 3
    else:
        assert call("one", "claim").status_code == 200
        revision = 2
    before = snapshot(app)
    barrier = Barrier(2)

    def mutate(action):
        barrier.wait(timeout=10)
        return call(
            "one" if action == "decision" else "owner",
            action,
            revision,
            reason="Concurrent review action",
            **({"decision": "rejected"} if action == "decision" else {}),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(mutate, pair.split("-")))
    assert sorted(r.status_code for r in responses) == [200, 409]
    with app.state.db.session() as s:
        r = s.get(Review, "review")
        assert r.revision == revision + 1
        if r.status != "rejected":
            assert snapshot(app) == before


def test_review_changes_migration_roundtrip_and_data_guard(workflow):
    import os
    import subprocess
    import sys

    from aag.models import Base
    from sqlalchemy import inspect

    app, _, _ = workflow
    engine = app.state.db.engine
    Base.metadata.drop_all(engine)

    def migrate(target, direction="upgrade", check=True):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", direction, target],
            env={**os.environ, "AAG_DATABASE_URL": str(engine.url)},
            capture_output=True,
            text=True,
            check=check,
        )
        engine.dispose()
        return result

    migrate("c1c1c1c1c101")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users (id,subject,name,role,reviewer,active,created_at) VALUES ('old','local:old','old','user',false,true,1)"
            )
        )
        c.execute(
            text(
                "INSERT INTO notification_preferences (user_id,scans,review_requests,review_results,comments) VALUES ('old',false,true,false,true)"
            )
        )
    migrate("head")
    with engine.connect() as c:
        assert c.execute(
            text(
                "SELECT scans,review_results,review_updates FROM notification_preferences WHERE user_id='old'"
            )
        ).one() == (False, False, True)
    assert "closed_reason" in {c["name"] for c in inspect(engine).get_columns("reviews")}
    assert "review_updates" in {
        c["name"] for c in inspect(engine).get_columns("notification_preferences")
    }
    migrate("c1c1c1c1c101", "downgrade")
    assert "closed_reason" not in {c["name"] for c in inspect(engine).get_columns("reviews")}
    migrate("head")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users (id,subject,name,role,reviewer,active,created_at) VALUES ('u','local:u','u','user',false,true,1)"
            )
        )
        c.execute(
            text(
                "INSERT INTO notification_preferences (user_id,scans,review_requests,review_results,comments,review_updates) VALUES ('u',true,true,true,true,false)"
            )
        )
    assert migrate("c1c1c1c1c101", "downgrade", False).returncode != 0


def test_legacy_atomic_claim_delivers_assignment_update(workflow):
    app, _, call = workflow
    assert (
        call("one", "decision", decision="rejected", reason="Atomic legacy decision").status_code
        == 200
    )
    with app.state.db.session() as s:
        assert set(s.scalars(select(Notification.kind))) == {"review.claimed", "review.rejected"}


@pytest.mark.parametrize("action", ["request-changes", "respond", "withdraw", "release"])
def test_each_transition_delivery_failure_rolls_back(workflow, monkeypatch, action):
    from aag import review_workflow

    app, _, call = workflow
    assert call("one", "claim").status_code == 200
    revision = 2
    if action == "respond":
        assert (
            call("one", "request-changes", 2, reason="Need supplementary evidence").status_code
            == 200
        )
        revision = 3
    with app.state.db.session() as s:
        counts = [
            len(list(s.scalars(select(model)))) for model in [ReviewEvent, Audit, Notification]
        ]
    before = snapshot(app)
    original = review_workflow.emit_notification

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("synthetic atomic failure")

    monkeypatch.setattr(review_workflow, "emit_notification", fail)
    with pytest.raises(RuntimeError, match="synthetic atomic failure"):
        call(
            "owner" if action in {"respond", "withdraw"} else "one",
            action,
            revision,
            reason="Keep this transaction atomic",
        )
    with app.state.db.session() as s:
        assert s.get(Review, "review").revision == revision
        assert counts == [
            len(list(s.scalars(select(model)))) for model in [ReviewEvent, Audit, Notification]
        ]
    assert snapshot(app) == before


def test_deduplicated_self_excluded_delivery_and_snapshot_boundary(workflow):
    from aag.notifications import emit_notification

    app, client, call = workflow
    headers = {
        "Cookie": "aag_session=owner",
        "Origin": "http://localhost:8000",
        "X-AAG-Account": "owner",
    }
    assert call("one", "claim").status_code == 200
    boundary = client.get("/api/notifications", headers=headers).json()
    barrier = Barrier(2)

    def deliver(_):
        barrier.wait(timeout=10)
        with app.state.db.session.begin() as s:
            emit_notification(
                s,
                "review.released",
                s.get(Job, "job"),
                ["owner", "owner", "one"],
                "synthetic-duplicate",
                "review",
                actor_id="one",
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(deliver, range(2)))
    assert (
        client.post(
            "/api/notifications/read-all",
            headers=headers,
            json={"before": boundary["snapshot_at"], "through": boundary["snapshot_sequence"]},
        ).status_code
        == 200
    )
    inbox = client.get("/api/notifications", headers=headers).json()
    assert inbox["total"] == 2 and inbox["unread_count"] == 1
    with app.state.db.session() as s:
        assert list(s.scalars(select(Notification).where(Notification.recipient_id == "one"))) == []


def test_response_requires_changes_and_current_reviewer_cannot_be_stale(workflow):
    from aag.auth import Actor, actor

    app, _, call = workflow
    assert call("owner", "respond", reason="No outstanding request").status_code == 409
    assert call("one", "claim").status_code == 200
    app.dependency_overrides[actor] = lambda: Actor("one", "one", "user", True)
    with app.state.db.session.begin() as s:
        s.get(User, "one").reviewer = False
    try:
        assert (
            call("one", "request-changes", 2, reason="Stale local qualification").status_code == 403
        )
    finally:
        app.dependency_overrides.clear()
    with app.state.db.session() as s:
        assert s.get(Review, "review").revision == 2


def test_database_default_review_updates_allows_delivery(workflow):
    app, _, call = workflow
    with app.state.db.session.begin() as s:
        s.execute(
            text(
                "INSERT INTO notification_preferences (user_id,scans,review_requests,review_results,comments) VALUES ('owner',true,true,true,true)"
            )
        )
    assert call("one", "claim").status_code == 200
    with app.state.db.session() as s:
        assert list(s.scalars(select(Notification.kind))) == ["review.claimed"]
