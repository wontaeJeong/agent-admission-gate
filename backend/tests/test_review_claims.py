"""Real HTTP transitions on owned SQLite and PostgreSQL databases."""

import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from aag.auth import digest, issue_key
from aag.config import Settings
from aag.main import create_app
from aag.models import Job, Review, Session, User
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text


@pytest.fixture(params=["sqlite", "postgresql"])
def workflow(request, tmp_path):
    admin = None
    schema = "aag_c1_" + uuid.uuid4().hex
    if request.param == "postgresql":
        url = os.environ.get("AAG_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("Set AAG_TEST_POSTGRES_URL to owned synthetic PostgreSQL")
        admin = create_engine(url)
        with admin.begin() as c:
            c.execute(text(f'CREATE SCHEMA "{schema}"'))
        url += "?options=-csearch_path%3D" + schema
    else:
        url = "sqlite:///" + str(tmp_path / "workflow.db")
    app = create_app(
        Settings(
            environment="test",
            database_url=url,
            public_url="http://localhost:8000",
            bootstrap_password="synthetic-password",
            api_keys_enabled=True,
        )
    )
    # The feature is deliberately enabled only for these owned fixtures.
    app.state.settings.__dict__["review_workflow_enabled"] = True
    try:
        with TestClient(app, base_url="http://localhost:8000") as client:
            with app.state.db.session.begin() as s:
                for name, role, reviewer in [
                    ("owner", "user", True),
                    ("one", "user", True),
                    ("two", "user", True),
                    ("ops", "admin", False),
                    ("other", "user", False),
                ]:
                    s.add(
                        User(
                            id=name,
                            subject="local:" + name,
                            name=name,
                            role=role,
                            reviewer=reviewer,
                        )
                    )
                s.flush()
                for name in ["owner", "one", "two", "ops", "other"]:
                    s.add(Session(digest=digest(name), user_id=name, expires_at=time.time() + 3600))
                j = Job(
                    id="job",
                    owner_id="owner",
                    source="synthetic all.zip",
                    source_type="upload",
                    profile="static",
                    status="COMPLETED",
                    verdict="REVIEW",
                    effective_verdict="REVIEW",
                    result={"coverage_complete": True},
                )
                s.add(j)
                s.flush()
                s.add(
                    Review(id="review", job_id=j.id, requester_id="owner", reason="Please review")
                )

            def call(name, action, revision=1, **fields):
                return client.post(
                    "/api/reviews/review/" + action,
                    headers={
                        "Origin": "http://localhost:8000",
                        "Cookie": "aag_session=" + name,
                        "X-AAG-Account": name,
                    },
                    json={"expected_revision": revision, **fields},
                )

            yield app, client, call
    finally:
        app.state.db.engine.dispose()
        if admin:
            with admin.begin() as c:
                c.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


def test_two_claims_one_winner(workflow):
    app, client, call = workflow
    barrier = Barrier(2)

    def claim(name):
        barrier.wait(timeout=10)
        return call(name, "claim")

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(claim, ["one", "two"]))
    assert sorted(r.status_code for r in responses) == [200, 409]
    winner = next(r.json() for r in responses if r.status_code == 200)
    assert winner["workflow_state"] == "in_review"
    assert winner["revision"] == 2
    assert winner["assignee"]["id"] in {"one", "two"}
    assert winner["reviewer_id"] is None


def test_self_claim_forbidden(workflow):
    assert workflow[2]("owner", "claim").status_code == 403


def test_admin_without_reviewer_cannot_claim(workflow):
    assert workflow[2]("ops", "claim").status_code == 403


def test_other_assignee_cannot_decide(workflow):
    _, _, call = workflow
    assert call("one", "claim").status_code == 200
    assert (
        call("two", "decision", 2, decision="approved", reason="Complete review").status_code == 409
    )
    assert (
        call("one", "decision", 2, decision="approved", reason="Complete review").status_code == 200
    )


def test_stale_claim_release_requires_reason(workflow):
    app, _, call = workflow
    assert call("one", "claim").status_code == 200
    assert call("two", "release", 2, reason="Take over").status_code == 403
    with app.state.db.session.begin() as s:
        s.get(User, "one").reviewer = False
    assert call("two", "release", 2).status_code == 422
    assert call("two", "release", 2, reason="Lost qualification").status_code == 200
    with app.state.db.session() as s:
        r = s.get(Review, "review")
        assert (r.assignee_id, r.workflow_state, r.revision) == (None, "waiting", 3)


def test_changes_requested_release_preserves_state_and_legacy_cannot_decide(workflow):
    app, client, call = workflow
    assert call("one", "claim").status_code == 200
    with app.state.db.session.begin() as s:
        s.get(Review, "review").workflow_state = "changes_requested"
        s.get(User, "one").active = False
    assert call("ops", "release", 2, reason="Inactive assignee").status_code == 200
    assert call("two", "claim", 3).status_code == 409
    assert (
        call("two", "decision", 3, decision="approved", reason="Must not skip").status_code == 409
    )
    assert (
        client.post(
            "/api/reviews/review/decision",
            headers={"Origin": "http://localhost:8000", "Cookie": "aag_session=two"},
            json={"decision": "approved", "reason": "Must not skip"},
        ).status_code
        == 409
    )
    with app.state.db.session() as s:
        assert s.get(Review, "review").workflow_state == "changes_requested"


def test_flag_off_preserves_assigned_decision_and_blocks_transitions(workflow):
    app, client, call = workflow
    assert call("one", "claim").status_code == 200
    app.state.settings.review_workflow_enabled = False
    assert call("one", "release", 2).status_code == 404
    assert (
        client.get("/api/reviews/review", headers={"Cookie": "aag_session=owner"}).json()[
            "assignee"
        ]["id"]
        == "one"
    )
    assert call("two", "decision", 2, decision="approved", reason="Not assigned").status_code == 409
    assert (
        call("one", "decision", 2, decision="approved", reason="Assigned approval").status_code
        == 200
    )


def test_legacy_decision_claims_atomically_and_coverage_remains_required(workflow):
    app, client, call = workflow
    app.state.settings.review_workflow_enabled = False
    with app.state.db.session.begin() as s:
        s.get(Job, "job").result = {"coverage_complete": False}
    assert (
        call("one", "decision", decision="approved", reason="Missing coverage").status_code == 409
    )
    response = client.post(
        "/api/reviews/review/decision",
        headers={"Origin": "http://localhost:8000", "Cookie": "aag_session=one"},
        json={"decision": "rejected", "reason": "Legacy rejection"},
    )
    assert response.status_code == 200
    with app.state.db.session() as s:
        r = s.get(Review, "review")
        assert (r.assignee_id, r.reviewer_id, r.workflow_state, r.revision) == (
            "one",
            "one",
            "closed",
            2,
        )


def test_account_revision_unknown_fields_and_key_ceiling(workflow):
    app, client, call = workflow
    headers = {"Origin": "http://localhost:8000", "Cookie": "aag_session=one"}
    assert (
        client.post(
            "/api/reviews/review/claim", headers=headers, json={"expected_revision": 1}
        ).status_code
        == 409
    )
    assert call("one", "claim", unexpected=True).status_code == 422
    assert call("one", "claim", True).status_code == 422
    with app.state.db.session.begin() as s:
        _, token = issue_key(s, "one", "synthetic")
    assert (
        client.post(
            "/api/reviews/review/claim",
            headers={"Authorization": "Bearer " + token, "X-AAG-Account": "one"},
            json={"expected_revision": 1},
        ).status_code
        == 403
    )


def test_decision_release_race_one_winner(workflow):
    app, _, call = workflow
    assert call("one", "claim").status_code == 200
    barrier = Barrier(2)

    def mutate(action):
        barrier.wait(timeout=10)
        return call(
            "one",
            action,
            2,
            **(
                {"decision": "rejected", "reason": "Decision reason"}
                if action == "decision"
                else {}
            ),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(mutate, ["decision", "release"]))
    assert sorted(r.status_code for r in responses) == [200, 409]
    with app.state.db.session() as s:
        r, j = s.get(Review, "review"), s.get(Job, "job")
        assert r.revision == 3
        assert j.effective_verdict == ("BLOCK" if r.status == "rejected" else "REVIEW")


def test_pending_filters_and_metrics_share_predicate(workflow):
    app, client, call = workflow
    assert call("one", "claim").status_code == 200
    headers = {"Cookie": "aag_session=one"}
    assert client.get("/api/reviews?tab=pending", headers=headers).json()["total"] == 1
    assert (
        client.get("/api/reviews?tab=pending&assignee=unassigned", headers=headers).json()["total"]
        == 0
    )
    assert (
        client.get(
            "/api/reviews?tab=actionable&assignee=me&q=all&sort=oldest", headers=headers
        ).json()["total"]
        == 1
    )
    with app.state.db.session.begin() as s:
        s.get(Review, "review").workflow_state = "changes_requested"
    assert client.get("/api/reviews?tab=pending", headers=headers).json()["total"] == 1
    assert client.get("/api/reviews?tab=actionable", headers=headers).json()["total"] == 0
    metrics = client.get("/api/metrics?scope=review", headers=headers).json()
    assert metrics["pending_reviews"] == 1
    assert metrics["actionable_reviews"] == 0


def test_permission_loss_after_authentication_is_checked_in_transaction(workflow):
    from aag.auth import Actor, actor

    app, _, call = workflow
    assert call("one", "claim").status_code == 200
    # Pin a previously authenticated actor; local demotion must still take effect.
    app.dependency_overrides[actor] = lambda: Actor("one", "one", "user", True)
    with app.state.db.session.begin() as s:
        s.get(User, "one").reviewer = False
    try:
        assert (
            call(
                "one", "decision", 2, decision="approved", reason="Stale qualification"
            ).status_code
            == 403
        )
        with app.state.db.session() as s:
            assert s.get(Review, "review").revision == 2
            assert s.get(Job, "job").effective_verdict == "REVIEW"
    finally:
        app.dependency_overrides.clear()


def test_event_failure_rolls_back_domain_and_audit(workflow, monkeypatch):
    from aag import review_workflow
    from aag.models import Audit, ReviewEvent

    app, _, call = workflow

    def fail(*args, **kwargs):
        raise RuntimeError("synthetic persistence failure")

    monkeypatch.setattr(review_workflow, "event", fail)
    with pytest.raises(RuntimeError, match="synthetic persistence failure"):
        call("one", "claim")
    with app.state.db.session() as s:
        assert s.get(Review, "review").revision == 1
        assert s.get(Review, "review").assignee_id is None
        assert list(s.scalars(select(ReviewEvent))) == []
        assert list(s.scalars(select(Audit).where(Audit.target_id == "review"))) == []


def test_review_migration_roundtrip_backfill_and_data_guard(workflow):
    import subprocess
    import sys

    from aag.models import Base
    from sqlalchemy import inspect

    app, _, _ = workflow
    engine = app.state.db.engine
    # The fixture owns this fresh UUID schema/file, including all seed records.
    Base.metadata.drop_all(engine)

    def migrate(target, direction="upgrade", check=True):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", direction, target],
            env={**os.environ, "AAG_DATABASE_URL": str(engine.url)},
            check=check,
            capture_output=True,
            text=True,
        )
        engine.dispose()
        return result

    migrate("f1b1b1b1b101")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users (id,subject,name,role,reviewer,active,created_at) VALUES ('old-owner','local:old-owner','old owner','user',false,true,1)"
            )
        )
        for status in ["pending", "approved", "rejected"]:
            c.execute(
                text(
                    "INSERT INTO jobs (id,owner_id,source,source_type,profile,status,result,created_at) VALUES (:id,'old-owner','old.zip','upload','static','COMPLETED','{}',1)"
                ),
                {"id": status},
            )
            c.execute(
                text(
                    "INSERT INTO reviews (id,job_id,requester_id,reason,status,reviewer_id,created_at) VALUES (:id,:id,'old-owner','Original reason',:id,'old-owner',1)"
                ),
                {"id": status},
            )
    migrate("head")
    with engine.connect() as c:
        rows = c.execute(
            text(
                "SELECT status,workflow_state,assignee_id,claimed_at,revision,reviewer_id FROM reviews ORDER BY status"
            )
        ).all()
        assert rows == [
            ("approved", "closed", None, None, 1, "old-owner"),
            ("pending", "waiting", None, None, 1, "old-owner"),
            ("rejected", "closed", None, None, 1, "old-owner"),
        ]
        assert c.scalar(text("SELECT count(*) FROM review_events")) == 0
    migrate("f1b1b1b1b101", "downgrade")
    assert "assignee_id" not in {col["name"] for col in inspect(engine).get_columns("reviews")}
    migrate("head")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO review_events (id,review_id,actor_id,kind,from_state,to_state,reason,created_at) VALUES ('owned-event','pending','old-owner','claim','waiting','in_review',null,2)"
            )
        )
    assert migrate("f1b1b1b1b101", "downgrade", False).returncode != 0
    with engine.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM review_events")) == 1


def test_legacy_decision_and_claim_race(workflow):
    app, client, call = workflow
    barrier = Barrier(2)

    def mutate(action):
        barrier.wait(timeout=10)
        if action == "claim":
            return call("one", "claim")
        return client.post(
            "/api/reviews/review/decision",
            headers={"Origin": "http://localhost:8000", "Cookie": "aag_session=two"},
            json={"decision": "rejected", "reason": "Legacy concurrent review"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(mutate, ["claim", "decision"]))
    assert sorted(r.status_code for r in results) == [200, 409]
    with app.state.db.session() as s:
        r = s.get(Review, "review")
        assert r.revision == 2
        assert (r.status, r.assignee_id) in {("pending", "one"), ("rejected", "two")}


def test_admin_release_requires_reason_but_does_not_grant_approval(workflow):
    _, _, call = workflow
    assert call("one", "claim").status_code == 200
    assert call("ops", "release", 2).status_code == 422
    assert call("ops", "release", 2, reason="Operational reassignment").status_code == 200
    assert (
        call("ops", "decision", 3, decision="approved", reason="Not qualified").status_code == 403
    )


def test_review_saved_view_and_login_return_keep_supported_filters(workflow):
    from aag.return_paths import normalize_return_to

    _, client, _ = workflow
    filters = {
        "version": 1,
        "tab": "actionable",
        "stage": "in_review",
        "assignee": "me",
        "q": "all",
        "sort": "oldest",
    }
    headers = {
        "Cookie": "aag_session=one",
        "Origin": "http://localhost:8000",
        "X-AAG-Account": "one",
    }
    response = client.post(
        "/api/saved-views",
        headers=headers,
        json={"resource": "reviews", "name": "My assigned reviews", "filters": filters},
    )
    assert response.status_code == 201
    assert response.json()["filters"] == filters
    target = "/reviews?tab=actionable&stage=in_review&assignee=me&q=all&sort=oldest"
    assert normalize_return_to(target + "&token=excluded") == target


def test_admin_demotion_and_decision_do_not_deadlock_on_requester_fk(workflow):
    from threading import Event

    from sqlalchemy import event

    app, client, call = workflow
    # Requester is an administrator, so the last-admin lock includes the FK recipient.
    with app.state.db.session.begin() as s:
        s.get(User, "owner").role = "admin"
    reviewer_locked, admins_locked = Event(), Event()

    def coordinate(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("UPDATE users SET name=users.name"):
            reviewer_locked.set()
            assert admins_locked.wait(10), "Admin lock step was not reached"
        if statement.startswith("SELECT") and "WHERE users.role =" in statement:
            admins_locked.set()

    event.listen(app.state.db.engine, "after_cursor_execute", coordinate)

    def demote():
        assert reviewer_locked.wait(10)
        return client.patch(
            "/api/admin/users/one",
            headers={
                "Origin": "http://localhost:8000",
                "Cookie": "aag_session=ops",
                "X-AAG-Account": "ops",
            },
            json={"role": "user", "reviewer": False, "active": True},
        )

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            decision = pool.submit(
                call,
                "one",
                "decision",
                1,
                decision="rejected",
                reason="Concurrent permission update",
            )
            admin = pool.submit(demote)
            assert decision.result(timeout=20).status_code == 200
            assert admin.result(timeout=20).status_code == 200
    finally:
        event.remove(app.state.db.engine, "after_cursor_execute", coordinate)
    with app.state.db.session() as s:
        assert s.get(User, "one").reviewer is False
        assert s.get(Review, "review").status == "rejected"
