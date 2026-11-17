"""C3 exact-source follow-ups through HTTP on SQLite and PostgreSQL."""

import copy
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from aag.db import record
from aag.models import Audit, Job, Notification, Review, ReviewEvent, User
from sqlalchemy import select
from test_review_claims import workflow as workflow


def prepare(workflow, status="changes_requested"):
    app, _, call = workflow
    if status == "changes_requested":
        assert call("one", "claim").status_code == 200
        assert (
            call("one", "request-changes", 2, reason="Please scan corrected content").status_code
            == 200
        )
        revision = 3
    else:
        assert (
            call(
                "one", "decision", decision=status, reason="Original evidence decision"
            ).status_code
            == 200
        )
        revision = 2
    with app.state.db.session.begin() as s:
        old = s.get(Job, "job")
        old.content_hash = "a" * 64
        old.lineage_root_id = old.id
        s.add(
            Job(
                id="new",
                owner_id="owner",
                source="renamed.zip",
                source_type="upload",
                profile="static",
                status="COMPLETED",
                verdict="REVIEW",
                effective_verdict="REVIEW",
                result={"coverage_complete": True},
                content_hash="b" * 64,
                origin_job_id=old.id,
                lineage_root_id=old.id,
                created_at=old.created_at + 1,
            )
        )
    return revision


def follow(call, revision, job="new", actor="owner"):
    return call(
        actor,
        "follow-ups",
        revision,
        new_job_id=job,
        reason="Corrected content for independent review",
    )


def test_changes_followup_supersedes_previous(workflow):
    app, client, call = workflow
    rev = prepare(workflow)
    with app.state.db.session() as s:
        before = copy.deepcopy(record(s.get(Job, "job")))
    response = follow(call, rev)
    assert response.status_code == 201
    new = response.json()
    assert (new["status"], new["workflow_state"], new["revision"]) == ("pending", "waiting", 1)
    assert new["previous_review_id"] == "review"
    assert new["assignee_id"] is None and new["reviewer_id"] is None
    assert new["decision_reason"] is None and new["decided_at"] is None
    with app.state.db.session() as s:
        old = s.get(Review, "review")
        assert (old.status, old.workflow_state, old.closed_reason, old.revision) == (
            "withdrawn",
            "closed",
            "superseded",
            rev + 1,
        )
        assert record(s.get(Job, "job")) == before
    detail = client.get("/api/reviews/review", headers={"Cookie": "aag_session=owner"}).json()
    assert detail["next_review_id"] == new["id"]
    assert detail["next_content_hash"] == "b" * 64
    assert new["previous_content_hash"] == "a" * 64


def test_rejected_followup_keeps_original(workflow):
    app, _, call = workflow
    rev = prepare(workflow, "rejected")
    with app.state.db.session() as s:
        before = copy.deepcopy(record(s.get(Review, "review")))
    assert follow(call, rev).status_code == 201
    with app.state.db.session() as s:
        assert record(s.get(Review, "review")) == before


def test_approved_followup_rejected(workflow):
    _, _, call = workflow
    rev = prepare(workflow, "approved")
    assert follow(call, rev).status_code == 409


def test_foreign_job_hidden(workflow):
    app, _, call = workflow
    rev = prepare(workflow)
    with app.state.db.session.begin() as s:
        s.get(Job, "new").owner_id = "other"
    assert follow(call, rev).status_code == 404
    assert follow(call, rev, actor="ops").status_code == 403
    assert follow(call, rev, actor="other").status_code == 404


@pytest.mark.parametrize(
    "change",
    [
        "foreign_old_owner",
        "type",
        "root",
        "missing_root",
        "older",
        "incomplete",
        "same",
        "withdrawn",
        "waiting",
        "git_other",
    ],
)
def test_invalid_lineage_and_state_rejected(workflow, change):
    app, _, call = workflow
    rev = prepare(workflow)
    with app.state.db.session.begin() as s:
        old, new, r = s.get(Job, "job"), s.get(Job, "new"), s.get(Review, "review")
        if change == "foreign_old_owner":
            old.owner_id = "other"
        if change == "type":
            new.source_type = "git"
        if change == "root":
            new.lineage_root_id = "unrelated"
        if change == "missing_root":
            new.lineage_root_id = None
        if change == "older":
            new.created_at = old.created_at - 1
        if change == "incomplete":
            new.status = "RUNNING"
        if change == "withdrawn":
            r.status, r.workflow_state = "withdrawn", "closed"
        if change == "waiting":
            r.workflow_state = "waiting"
        if change == "git_other":
            old.source_type = new.source_type = "git"
            old.source, new.source = (
                "https://github.com/team/one.git",
                "https://github.com/team/two.git",
            )
    response = follow(call, rev, "job" if change == "same" else "new")
    assert response.status_code in (404, 409, 422)
    with app.state.db.session() as s:
        assert len(list(s.scalars(select(Review)))) == 1


@pytest.mark.parametrize("source", ["git", "upload"])
def test_git_identity_and_zip_lineage_enforced(workflow, source):
    app, _, call = workflow
    rev = prepare(workflow)
    if source == "git":
        with app.state.db.session.begin() as s:
            for job_id in ["job", "new"]:
                j = s.get(Job, job_id)
                j.source_type = "git"
                j.source = "https://github.com/team/repository.git"
            s.get(Job, "new").lineage_root_id = "new"
            s.get(Job, "new").source = "https://GITHUB.com:443/team/repository/"
    assert follow(call, rev).status_code == 201


@pytest.mark.parametrize("source_state", ["rejected", "changes_requested"])
def test_two_followups_one_winner(workflow, source_state):
    app, _, call = workflow
    rev = prepare(workflow, source_state)
    with app.state.db.session.begin() as s:
        fields = record(s.get(Job, "new"))
        fields["id"] = "second"
        s.add(Job(**fields))
    barrier = Barrier(2)

    def create(job_id):
        barrier.wait(timeout=10)
        return follow(call, rev, job_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(create, ["new", "second"]))
    assert sorted(r.status_code for r in responses) == [201, 409]
    winner = next(r.json()["id"] for r in responses if r.status_code == 201)
    loser = next(r.json() for r in responses if r.status_code == 409)
    assert loser["detail"]["next_review_id"] == winner
    with app.state.db.session() as s:
        assert len(list(s.scalars(select(Review)))) == 2


def test_approval_not_carried_forward(workflow):
    app, client, call = workflow
    rev = prepare(workflow, "rejected")
    with app.state.db.session.begin() as s:
        s.get(Job, "new").result = {"coverage_complete": False}
    response = follow(call, rev)
    assert response.status_code == 201
    new = response.json()
    decision = client.post(
        "/api/reviews/" + new["id"] + "/decision",
        headers={
            "Origin": "http://localhost:8000",
            "Cookie": "aag_session=two",
            "X-AAG-Account": "two",
        },
        json={
            "expected_revision": 1,
            "decision": "approved",
            "reason": "Must not bypass missing coverage",
        },
    )
    assert decision.status_code == 409
    with app.state.db.session() as s:
        assert s.get(Job, "new").effective_verdict == "REVIEW"


def test_link_visibility_and_api_key_ceiling(workflow):
    from aag.auth import issue_key

    app, client, call = workflow
    rev = prepare(workflow)
    assert follow(call, rev).status_code == 201
    with app.state.db.session.begin() as s:
        new = s.scalar(select(Review).where(Review.job_id == "new"))
        new.requester_id = "other"
        s.get(User, "owner").reviewer = False
        _, token = issue_key(s, "owner", "synthetic")
    detail = client.get("/api/reviews/review", headers={"Cookie": "aag_session=owner"}).json()
    assert detail["next_review_id"] is None and detail["next_content_hash"] is None
    response = client.post(
        "/api/reviews/review/follow-ups",
        headers={"Authorization": "Bearer " + token, "X-AAG-Account": "owner"},
        json={"expected_revision": rev, "new_job_id": "new", "reason": "No key review writes"},
    )
    assert response.status_code == 403


def test_followup_failure_rolls_back(workflow, monkeypatch):
    from aag import review_workflow

    app, _, call = workflow
    rev = prepare(workflow)
    with app.state.db.session() as s:
        before = [
            len(list(s.scalars(select(model))))
            for model in [Review, ReviewEvent, User, Audit, Notification]
        ]
    original = review_workflow.emit_notification
    deliveries = []

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        deliveries.append(args[1])
        if {"review.withdrawn", "review.requested"} <= set(deliveries):
            raise RuntimeError("synthetic delivery failure")

    monkeypatch.setattr(review_workflow, "emit_notification", fail)
    with pytest.raises(RuntimeError, match="synthetic delivery failure"):
        follow(call, rev)
    with app.state.db.session() as s:
        assert before == [
            len(list(s.scalars(select(model))))
            for model in [Review, ReviewEvent, User, Audit, Notification]
        ]
        assert s.get(Review, "review").workflow_state == "changes_requested"
        assert s.get(Review, "review").revision == rev
    assert set(deliveries) == {"review.withdrawn", "review.requested"}


def test_strict_account_revision_flag_and_new_job_unique(workflow):
    app, client, call = workflow
    rev = prepare(workflow)
    headers = {
        "Origin": "http://localhost:8000",
        "Cookie": "aag_session=owner",
        "X-AAG-Account": "owner",
    }
    body = {"new_job_id": "new", "reason": "Corrected source", "expected_revision": rev}
    for fields in [
        {k: v for k, v in body.items() if k != "expected_revision"},
        {**body, "expected_revision": True},
        {**body, "reason": "     "},
        {**body, "unknown": 1},
        {**body, "new_job_id": ""},
    ]:
        assert (
            client.post("/api/reviews/review/follow-ups", headers=headers, json=fields).status_code
            == 422
        )
    for account in [None, "other"]:
        h = dict(headers)
        if account:
            h["X-AAG-Account"] = account
        else:
            del h["X-AAG-Account"]
        assert (
            client.post("/api/reviews/review/follow-ups", headers=h, json=body).status_code == 409
        )
    app.state.settings.review_workflow_enabled = False
    assert follow(call, rev).status_code == 404
    app.state.settings.review_workflow_enabled = True
    assert follow(call, rev - 1).status_code == 409
    with app.state.db.session.begin() as s:
        s.add(Review(job_id="new", requester_id="owner", reason="Already requested"))
    assert follow(call, rev).status_code == 409
    with app.state.db.session() as s:
        assert s.get(Review, "review").workflow_state == "changes_requested"


def test_followup_competes_with_withdraw(workflow):
    app, _, call = workflow
    rev = prepare(workflow)
    barrier = Barrier(2)

    def mutate(action):
        barrier.wait(timeout=10)
        return (
            follow(call, rev)
            if action == "follow"
            else call("owner", "withdraw", rev, reason="Close original request")
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(mutate, ["follow", "withdraw"]))
    assert sorted(r.status_code for r in responses) in ([201, 409], [200, 409])
    with app.state.db.session() as s:
        assert s.get(Review, "review").revision == rev + 1


def test_overlapping_notification_recipients_concurrent_followups(workflow):
    app, client, call = workflow
    rev = prepare(workflow)
    with app.state.db.session.begin() as s:
        # Another requester/assignee pair, sharing reviewer inboxes.
        s.get(User, "other").reviewer = False
        old_fields, new_fields = record(s.get(Job, "job")), record(s.get(Job, "new"))
        old_fields.update(id="other-old", owner_id="other", lineage_root_id="other-old")
        new_fields.update(
            id="other-new", owner_id="other", origin_job_id="other-old", lineage_root_id="other-old"
        )
        s.add_all([Job(**old_fields), Job(**new_fields)])
        s.flush()
        s.add(
            Review(
                id="other-review",
                job_id="other-old",
                requester_id="other",
                reason="Synthetic second request",
                workflow_state="changes_requested",
                assignee_id="two",
                revision=3,
            )
        )
    barrier = Barrier(2)

    def create(owner):
        barrier.wait(timeout=10)
        return client.post(
            "/api/reviews/" + ("review" if owner == "owner" else "other-review") + "/follow-ups",
            headers={
                "Origin": "http://localhost:8000",
                "Cookie": "aag_session=" + owner,
                "X-AAG-Account": owner,
            },
            json={
                "expected_revision": rev,
                "new_job_id": "new" if owner == "owner" else "other-new",
                "reason": "Independent corrected source",
            },
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(create, ["owner", "other"]))
    assert [r.status_code for r in responses] == [201, 201]
    with app.state.db.session() as s:
        for recipient, previous in [("one", "review"), ("two", "other-review")]:
            notifications = list(
                s.scalars(select(Notification).where(Notification.recipient_id == recipient))
            )
            assert len([n for n in notifications if n.kind == "review.requested"]) == 2
            assert (
                len(
                    [
                        n
                        for n in notifications
                        if n.kind == "review.withdrawn" and n.review_id == previous
                    ]
                )
                == 1
            )


def test_followups_migration_roundtrip_and_history_guard(workflow):
    import os
    import subprocess
    import sys

    from aag.models import Base
    from sqlalchemy import inspect, text

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

    migrate("c2c2c2c2c202")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users (id,subject,name,role,reviewer,active,created_at) VALUES ('u','local:u','u','user',false,true,1)"
            )
        )
        for job in ["old", "new"]:
            c.execute(
                text(
                    "INSERT INTO jobs (id,owner_id,source,source_type,profile,status,result,created_at) VALUES (:id,'u','source.zip','upload','static','COMPLETED','{}',1)"
                ),
                {"id": job},
            )
        c.execute(
            text(
                "INSERT INTO reviews (id,job_id,requester_id,reason,status,created_at,workflow_state) VALUES ('old','old','u','Original request','rejected',1,'closed')"
            )
        )
    migrate("head")
    with engine.connect() as c:
        assert c.scalar(text("SELECT previous_review_id FROM reviews WHERE id='old'")) is None
    constraints = inspect(engine).get_unique_constraints("reviews")
    assert any(c["column_names"] == ["previous_review_id"] for c in constraints)
    assert any(c["column_names"] == ["job_id"] for c in constraints)
    migrate("c2c2c2c2c202", "downgrade")
    migrate("head")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO reviews (id,job_id,requester_id,reason,status,created_at,previous_review_id) VALUES ('new','new','u','Follow-up request','pending',2,'old')"
            )
        )
    assert migrate("c2c2c2c2c202", "downgrade", False).returncode != 0
    with engine.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM reviews")) == 2


def test_one_new_job_cannot_follow_two_sources(workflow):
    app, client, call = workflow
    rev = prepare(workflow, "rejected")
    with app.state.db.session.begin() as s:
        fields = record(s.get(Job, "job"))
        fields["id"] = "second-old"
        s.add(Job(**fields))
        s.flush()
        s.add(
            Review(
                id="second-review",
                job_id="second-old",
                requester_id="owner",
                reason="Another original request",
                status="rejected",
                workflow_state="closed",
                revision=rev,
            )
        )
    barrier = Barrier(2)

    def create(source):
        barrier.wait(timeout=10)
        return client.post(
            "/api/reviews/" + source + "/follow-ups",
            headers={
                "Origin": "http://localhost:8000",
                "Cookie": "aag_session=owner",
                "X-AAG-Account": "owner",
            },
            json={
                "expected_revision": rev,
                "new_job_id": "new",
                "reason": "One independent follow-up request",
            },
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(create, ["review", "second-review"]))
    assert sorted(r.status_code for r in responses) == [201, 409]
    with app.state.db.session() as s:
        assert len(list(s.scalars(select(Review).where(Review.job_id == "new")))) == 1


def test_equal_time_zip_sibling_lineage_and_hidden_reverse_link(workflow):
    app, client, call = workflow
    rev = prepare(workflow, "rejected")
    with app.state.db.session.begin() as s:
        new = s.get(Job, "new")
        new.created_at = s.get(Job, "job").created_at
        # Explicit shared root is sufficient; immediate origin need not be the reviewed job.
        new.origin_job_id = "intermediate"
    response = follow(call, rev)
    assert response.status_code == 201
    with app.state.db.session.begin() as s:
        s.get(User, "owner").reviewer = False
        s.get(Review, "review").requester_id = "other"
    detail = client.get(
        "/api/reviews/" + response.json()["id"], headers={"Cookie": "aag_session=owner"}
    ).json()
    assert detail["previous_review_id"] is None and detail["previous_content_hash"] is None
    assert (
        client.get("/api/reviews/review", headers={"Cookie": "aag_session=owner"}).status_code
        == 404
    )
