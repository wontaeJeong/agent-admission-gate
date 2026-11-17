"""Typed delivery must preserve live authority, snapshots and durable legacy rows."""

import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from aag import notifications
from aag.models import APIKey, Base, ExceptionRule, Job, Notification, User
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from test_review_claims import workflow as workflow


def headers(name="owner"):
    return {
        "Origin": "http://localhost:8000",
        "Cookie": "aag_session=" + name,
        "X-AAG-Account": name,
    }


def inbox(client, name="owner", **params):
    r = client.get("/api/notifications", headers=headers(name), params=params)
    assert r.status_code == 200, r.text
    return r.json()


def emit(
    s,
    kind="key.expiring_7d",
    resource_type="api_key",
    resource_id="key",
    recipients=None,
    event_key="first",
):
    producer = getattr(notifications, "emit_resource_notification", None)
    assert callable(producer), "typed resource producer is missing"
    return producer(s, kind, resource_type, resource_id, recipients or ["owner"], event_key)


@pytest.fixture
def targets(workflow):
    app, client, _ = workflow
    with app.state.db.session.begin() as s:
        s.add(
            APIKey(
                id="key",
                owner_id="owner",
                name="Build integration",
                digest="synthetic-digest",
                suffix="abcd",
                expires_at=time.time() + 3600,
            )
        )
        s.add(
            ExceptionRule(
                id="exception",
                created_by="ops",
                source="synthetic.zip",
                fingerprint="a" * 64,
                content_hash="b" * 64,
                reason="Private reason omitted",
                expires_at=time.time() + 3600,
            )
        )
    return app, client


def test_key_notification_owner_only(targets):
    app, client = targets
    with app.state.db.session.begin() as s:
        emit(s, recipients=["owner", "ops", "other"])
    data = inbox(client)
    assert data["total"] == data["unread_count"] == 1
    n = data["items"][0]
    assert (n["resource_type"], n["resource_id"], n["source"], n["href"], n["target_state"]) == (
        "api_key",
        "key",
        "Build integration",
        "/api-keys?key=key",
        "active",
    )
    assert "digest" not in str(n) and "abcd" not in str(n)
    assert inbox(client, "ops")["total"] == inbox(client, "other")["total"] == 0


def test_exception_notification_requires_current_admin_creator(targets):
    app, client = targets
    with app.state.db.session.begin() as s:
        emit(s, "exception.expiring_1d", "exception", "exception", ["ops", "owner", "other"])
    data = inbox(client, "ops")
    assert data["total"] == 1
    n = data["items"][0]
    assert n["href"] == "/admin?tab=allowlist&exception=exception"
    assert "Private reason" not in str(data)
    with app.state.db.session.begin() as s:
        s.get(User, "ops").role = "user"
        emit(s, "exception.expired", "exception", "exception", ["ops"], "lost-role")
    assert inbox(client, "ops")["total"] == 0
    assert (
        client.patch(
            "/api/notifications/" + n["id"], headers=headers("ops"), json={"read": True}
        ).status_code
        == 404
    )
    with app.state.db.session() as s:
        assert s.scalar(select(func.count()).select_from(Notification)) == 1


@pytest.mark.parametrize("loss", ["owner", "deleted", "inactive"])
def test_count_list_mutation_share_visibility(targets, loss):
    app, client = targets
    with app.state.db.session.begin() as s:
        emit(s)
    snapshot = inbox(client)
    n = snapshot["items"][0]
    with app.state.db.session.begin() as s:
        if loss == "owner":
            s.get(APIKey, "key").owner_id = "other"
        elif loss == "deleted":
            s.delete(s.get(APIKey, "key"))
        else:
            s.get(User, "owner").active = False
        if loss == "deleted":
            s.flush()
            with pytest.raises(ValueError):
                emit(s, event_key="hidden")
        else:
            emit(s, event_key="hidden")
    expected_status = 401 if loss == "inactive" else 200
    r = client.get("/api/notifications", headers=headers())
    assert r.status_code == expected_status
    r = client.get("/api/notifications/unread-count", headers=headers())
    assert r.status_code == expected_status
    if loss != "inactive":
        assert r.json()["unread_count"] == inbox(client)["total"] == 0
    assert client.patch(
        "/api/notifications/" + n["id"], headers=headers(), json={"archived": True}
    ).status_code == (401 if loss == "inactive" else 404)
    r = client.post(
        "/api/notifications/read-all",
        headers=headers(),
        json={"before": snapshot["snapshot_at"], "through": snapshot["snapshot_sequence"]},
    )
    assert r.status_code == expected_status
    if loss != "inactive":
        assert r.json()["updated"] == 0
    with app.state.db.session() as s:
        assert s.get(Notification, n["id"]).read_at is None


def test_nonjob_notifications_no_fake_job(targets):
    app, client = targets
    with app.state.db.session.begin() as s:
        emit(s)
        emit(s, "exception.expired", "exception", "exception", ["ops"])
        assert s.scalar(select(func.count()).select_from(Job)) == 1
        rows = s.scalars(select(Notification)).all()
        assert len(rows) == 2
        assert all(n.job_id is None and n.review_id is None and n.verdict is None for n in rows)


def test_read_all_sequence_preserved(targets):
    app, client = targets
    with app.state.db.session.begin() as s:
        emit(s)
    snapshot = inbox(client)
    with app.state.db.session.begin() as s:
        emit(s, "key.expiring_1d", event_key="second")
        # Even equal/backdated timestamps must not cross the sequence boundary.
        s.execute(
            text("UPDATE notifications SET created_at=:at"), {"at": snapshot["snapshot_at"] - 1}
        )
    r = client.post(
        "/api/notifications/read-all",
        headers=headers(),
        json={
            "category": "credentials",
            "before": snapshot["snapshot_at"],
            "through": snapshot["snapshot_sequence"],
        },
    )
    assert r.status_code == 200 and r.json()["updated"] == 1
    assert inbox(client, category="credentials", state="unread")["total"] == 1


def test_revoked_retained_and_preferences_apply_to_future_only(targets):
    app, client = targets
    with app.state.db.session.begin() as s:
        emit(s)
        s.get(APIKey, "key").revoked_at = time.time()
    n = inbox(client)["items"][0]
    assert n["target_state"] == "revoked"
    assert (
        client.patch(
            "/api/notifications/" + n["id"], headers=headers(), json={"read": True}
        ).status_code
        == 200
    )
    r = client.put(
        "/api/notification-preferences",
        headers=headers(),
        json={"credentials": False, "exceptions": False},
    )
    assert r.status_code == 200 and r.json()["credentials"] is False
    assert (
        client.put(
            "/api/notification-preferences", headers=headers(), json={"credentials": None}
        ).status_code
        == 422
    )
    with app.state.db.session.begin() as s:
        emit(s, event_key="opt-out")
    assert inbox(client)["total"] == 1


def test_registry_rejects_unknown_mismatched_and_missing_targets(targets):
    app, _ = targets
    for kind, resource_type, resource_id in [
        ("payload.url", "api_key", "key"),
        ("scan.completed", "api_key", "key"),
        ("key.expired", "unknown", "key"),
        ("key.expired", "api_key", "missing"),
    ]:
        with pytest.raises(ValueError), app.state.db.session.begin() as s:
            emit(s, kind, resource_type, resource_id)
    with pytest.raises(ValueError), app.state.db.session.begin() as s:
        notifications.emit_notification(
            s, "review.approved", s.get(Job, "job"), ["owner"], "wrong", review_id="missing"
        )


def test_typed_delivery_dedup_concurrency_and_rollback(targets):
    app, client = targets
    barrier = Barrier(2)

    def deliver(_):
        barrier.wait(timeout=10)
        with app.state.db.session.begin() as s:
            emit(s)

    with ThreadPoolExecutor(2) as pool:
        list(pool.map(deliver, range(2)))
    assert inbox(client)["total"] == 1
    with pytest.raises(RuntimeError), app.state.db.session.begin() as s:
        emit(s, event_key="rollback")
        raise RuntimeError("rollback")
    assert inbox(client)["total"] == 1


def test_old_scan_notifications_backfill(workflow):
    app, _, _ = workflow
    engine = app.state.db.engine
    Base.metadata.drop_all(engine)

    def migrate(target, direction="upgrade", check=True):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", direction, target],
            env={**os.environ, "AAG_DATABASE_URL": str(engine.url)},
            capture_output=True,
            text=True,
        )
        engine.dispose()
        if check:
            assert result.returncode == 0, result.stderr
        return result

    migrate("e2e2e2e2e202")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users (id,subject,name,role,reviewer,active,created_at) VALUES ('old','local:old','Old','user',false,true,1)"
            )
        )
        c.execute(
            text(
                "INSERT INTO jobs (id,owner_id,source,source_type,profile,status,result,created_at) VALUES ('old-job','old','old.zip','upload','static','COMPLETED','{}',1)"
            )
        )
        c.execute(
            text(
                "INSERT INTO reviews (id,job_id,requester_id,reason,status,created_at) VALUES ('old-review','old-job','old','old reason','approved',1)"
            )
        )
        for ident, kind, review in [
            ("scan", "scan.completed", None),
            ("review", "review.approved", "old-review"),
            ("comment", "comment.created", None),
        ]:
            c.execute(
                text(
                    "INSERT INTO notifications (id,recipient_id,event_key,sequence,kind,job_id,review_id,created_at) VALUES (:id,'old',:id,1,:kind,'old-job',:review,1)"
                ),
                {"id": ident, "kind": kind, "review": review},
            )
        c.execute(
            text(
                "INSERT INTO notification_preferences (user_id,scans,review_requests,review_results,comments) VALUES ('old',true,true,true,true)"
            )
        )
    migrate("head")
    with engine.connect() as c:
        assert c.execute(
            text("SELECT credentials,exceptions FROM notification_preferences")
        ).one() == (True, True)
    columns = {col["name"]: col for col in inspect(engine).get_columns("notifications")}
    assert "resource_type" in columns, "typed target migration is missing"
    assert columns["job_id"]["nullable"]
    with engine.connect() as c:
        assert c.execute(
            text("SELECT id,resource_type,resource_id FROM notifications ORDER BY id")
        ).all() == [
            ("comment", "scan", "old-job"),
            ("review", "review", "old-review"),
            ("scan", "scan", "old-job"),
        ]
    for values in [
        "'scan','old-job',NULL,NULL",
        "'scan','different','old-job',NULL",
        "'review','old-review',NULL,'old-review'",
        "'api_key','key','old-job',NULL",
        "'exception','exception',NULL,'old-review'",
        "'other','x',NULL,NULL",
    ]:
        with pytest.raises(IntegrityError), engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO notifications (id,recipient_id,event_key,sequence,kind,created_at,resource_type,resource_id,job_id,review_id) VALUES ('invalid','old','invalid',1,'scan.completed',1,"
                    + values
                    + ")"
                )
            )
    migrate("e2e2e2e2e202", "downgrade")
    migrate("head")
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO notifications (id,recipient_id,event_key,sequence,kind,created_at,resource_type,resource_id) VALUES ('typed','old','typed',2,'key.expired',1,'api_key','key')"
            )
        )
    result = migrate("e2e2e2e2e202", "downgrade", False)
    assert result.returncode != 0 and "read-compatible" in result.stderr
    with engine.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM notifications")) == 4


def test_query_selection_includes_old_authorized_target_beyond_list_cap(targets):
    app, client = targets
    with app.state.db.session.begin() as s:
        s.get(APIKey, "key").created_at = 1
        s.get(ExceptionRule, "exception").expires_at = 1
        s.add_all(
            [
                APIKey(
                    id=f"new-key-{i}",
                    owner_id="owner",
                    name="Recent key",
                    digest=f"synthetic-{i}",
                    suffix="test",
                    expires_at=time.time() + 3600,
                )
                for i in range(500)
            ]
        )
        s.add_all(
            [
                ExceptionRule(
                    id=f"new-exception-{i}",
                    created_by="ops",
                    source="Recent source",
                    fingerprint="a" * 64,
                    content_hash="b" * 64,
                    reason="Synthetic reason",
                    expires_at=time.time() + 3600,
                )
                for i in range(1000)
            ]
        )
    ordinary = client.get("/api/api-keys", headers=headers()).json()
    assert len(ordinary) == 500 and "key" not in {k["id"] for k in ordinary}
    selected = client.get("/api/api-keys?key=key", headers=headers()).json()
    assert len(selected) == 501 and selected[-1]["id"] == "key"
    assert client.get("/api/api-keys?key=key", headers=headers("other")).json() == []
    assert client.get("/api/api-keys?key=missing", headers=headers()).json() == ordinary
    ordinary = client.get("/api/admin/allowlist", headers=headers("ops")).json()
    assert len(ordinary) == 1000 and "exception" not in {e["id"] for e in ordinary}
    selected = client.get("/api/admin/allowlist?exception=exception", headers=headers("ops")).json()
    assert len(selected) == 1001 and selected[-1]["id"] == "exception"
    assert (
        client.get("/api/admin/allowlist?exception=missing", headers=headers("ops")).json()
        == ordinary
    )
    with app.state.db.session.begin() as s:
        s.get(User, "ops").role = "user"
    assert (
        client.get("/api/admin/allowlist?exception=exception", headers=headers("ops")).status_code
        == 403
    )
    assert client.get("/api/api-keys?key=" + "x" * 65, headers=headers()).status_code == 422


def test_target_projection_uses_same_authorized_snapshot(targets, monkeypatch):
    from aag import routes_notifications

    app, client = targets
    with app.state.db.session.begin() as s:
        emit(s)
    original = routes_notifications.notification_record

    def transfer_after_authorized_read(*args):
        with app.state.db.session.begin() as s:
            key = s.get(APIKey, "key")
            key.owner_id, key.name = "other", "Foreign updated label"
        return original(*args)

    monkeypatch.setattr(routes_notifications, "notification_record", transfer_after_authorized_read)
    data = inbox(client)
    assert data["items"][0]["source"] == "Build integration"
    assert "Foreign updated label" not in str(data)


@pytest.mark.parametrize(
    ("role", "reviewer", "remaining_groups", "hidden_kinds"),
    [
        ("admin", False, [], {"exception.expired", "comment.created", "review.claimed"}),
        ("user", True, [], {"review.requested", "comment.created", "review.claimed"}),
        ("admin", True, ["group-admin"], {"review.requested"}),
        ("admin", True, ["group-reviewer"], {"exception.expired"}),
    ],
)
def test_effective_oidc_qualification_bounds_every_inbox_operation(
    workflow, monkeypatch, role, reviewer, remaining_groups, hidden_kinds
):
    from aag.models import Review
    from test_identity_lifecycle import setup_keycloak

    app, client, _ = workflow
    # Exercise authenticate/check_identity's real intersection; mock only the
    # existing external Keycloak/upstream HTTP boundary.
    identity, user_id, _ = setup_keycloak(app, monkeypatch, role=role, reviewer=reviewer)
    account_headers = {
        "Origin": "http://localhost:8000",
        "Cookie": "aag_session=session-token",
        "X-AAG-Account": user_id,
    }
    with app.state.db.session.begin() as s:
        own_job = Job(
            id="oidc-own-job",
            owner_id=user_id,
            source="own.zip",
            source_type="upload",
            profile="static",
            status="COMPLETED",
        )
        s.add(own_job)
        s.flush()
        s.add(
            Review(
                id="oidc-own-review", job_id=own_job.id, requester_id=user_id, reason="Own review"
            )
        )
        s.add(
            ExceptionRule(
                id="oidc-own-exception",
                created_by=user_id,
                source="own.zip",
                reason="Synthetic exception",
                fingerprint="a" * 64,
                content_hash="b" * 64,
                expires_at=time.time() - 1,
            )
        )
        s.flush()
        key = s.scalar(select(APIKey).where(APIKey.owner_id == user_id))
        events = [
            ("scan.completed", "scan", own_job.id),
            ("review.approved", "review", "oidc-own-review"),
            ("key.expiring_1d", "api_key", key.id),
            ("comment.created", "scan", "job"),
            ("review.claimed", "review", "review"),
        ]
        if role == "admin":
            events.append(("exception.expired", "exception", "oidc-own-exception"))
        if reviewer:
            events.append(("review.requested", "review", "review"))
        for kind, resource_type, resource_id in events:
            emit(s, kind, resource_type, resource_id, [user_id], kind)

    before = client.get("/api/notifications", headers=account_headers).json()
    assert before["total"] == len(events)
    identity["upstream_groups"] = ["group-access", *remaining_groups]
    me = client.get("/api/auth/me", headers=account_headers).json()
    assert me["role"] == ("admin" if "group-admin" in remaining_groups else "user")
    assert me["reviewer"] == ("group-reviewer" in remaining_groups)
    with app.state.db.session() as s:
        stored = s.get(User, user_id)
        assert stored.active and stored.role == role and stored.reviewer == reviewer

    response = client.get("/api/notifications", headers=account_headers)
    assert response.status_code == 200
    after = response.json()
    expected_kinds = {kind for kind, _, _ in events} - hidden_kinds
    assert {n["kind"] for n in after["items"]} == expected_kinds
    assert (
        after["total"]
        == after["unread_count"]
        == after["filtered_unread_count"]
        == len(expected_kinds)
    )
    assert client.get("/api/notifications/unread-count", headers=account_headers).json() == {
        "unread_count": len(expected_kinds)
    }
    for n in before["items"]:
        if n["kind"] in hidden_kinds:
            for change in ({"read": True}, {"archived": True}, {"archived": False}):
                assert (
                    client.patch(
                        "/api/notifications/" + n["id"], headers=account_headers, json=change
                    ).status_code
                    == 404
                )
    marked = client.post(
        "/api/notifications/read-all",
        headers=account_headers,
        json={"before": before["snapshot_at"], "through": before["snapshot_sequence"]},
    )
    assert marked.status_code == 200 and marked.json()["updated"] == len(expected_kinds)
    with app.state.db.session() as s:
        rows = s.scalars(select(Notification).where(Notification.recipient_id == user_id)).all()
        for n in rows:
            assert (n.read_at is None) == (n.kind in hidden_kinds)
            assert n.archived_at is None
    own_key = next(n for n in after["items"] if n["kind"] == "key.expiring_1d")
    assert (
        client.patch(
            "/api/notifications/" + own_key["id"], headers=account_headers, json={"archived": True}
        ).status_code
        == 200
    )
    assert (
        client.patch(
            "/api/notifications/" + own_key["id"], headers=account_headers, json={"archived": False}
        ).status_code
        == 200
    )
