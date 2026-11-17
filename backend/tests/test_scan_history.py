import os
import uuid

import pytest
from aag.auth import Actor, issue_key, password_hash
from aag.config import Settings
from aag.main import create_app
from aag.models import APIKey, Job, Review, User
from conftest import login
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text


@pytest.fixture(params=["sqlite", "postgresql"])
def history(request, tmp_path):
    schema = "aag_b2_" + uuid.uuid4().hex
    admin = None
    if request.param == "postgresql":
        url = os.environ.get("AAG_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("Set AAG_TEST_POSTGRES_URL to owned synthetic PostgreSQL")
        admin = create_engine(url)
        with admin.begin() as c:
            c.execute(text(f'CREATE SCHEMA "{schema}"'))
        url += "?options=-csearch_path%3D" + schema
    else:
        url = "sqlite:///" + str(tmp_path / "history.db")
    app = create_app(
        Settings(
            environment="test",
            database_url=url,
            bootstrap_password="test-password-long",
            public_url="http://localhost:8000",
            api_keys_enabled=True,
        )
    )
    with TestClient(
        app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:8000"}
    ) as client:
        with app.state.db.session.begin() as s:
            for name in ("alice", "bob"):
                s.add(
                    User(
                        id=name,
                        subject="local:" + name,
                        name=name,
                        password_hash=password_hash("test-password-long"),
                    )
                )
            s.flush()
            _, token = issue_key(s, "alice", "history")
        login(client, "alice")
        yield app, client, token
    app.state.db.engine.dispose()
    if admin:
        with admin.begin() as c:
            c.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def seed(app, id, **kw):
    values = dict(
        owner_id="alice",
        source="https://github.com/example/repo.git",
        source_type="git",
        profile="static",
        ref="main",
        status="COMPLETED",
        verdict="BLOCK",
        effective_verdict="REVIEW",
        created_at=1,
        result={
            "coverage_complete": False,
            "engines": [{"name": "builtin", "status": "completed", "error": "ENGINE-SECRET"}],
            "raw": "RAW-SECRET",
        },
        error="ERROR-SECRET",
        lineage_root_id=id,
    )
    values.update(kw)
    with app.state.db.session.begin() as s:
        s.add(Job(id=id, **values))


def ids(response):
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()["items"]]


def test_history_same_git_different_refs_included(history):
    app, client, _ = history
    seed(app, "a", ref="main")
    seed(app, "b", ref="release", created_at=2)
    seed(app, "c", source="https://github.com/example/other.git")
    assert ids(client.get("/api/scans/a/history")) == ["b", "a"]


def test_history_excludes_other_owner(history):
    app, client, _ = history
    seed(app, "a")
    seed(app, "foreign", owner_id="bob")
    assert ids(client.get("/api/scans/a/history")) == ["a"]
    assert client.get("/api/scans/foreign/history").status_code == 404
    login(client, "admin")
    assert ids(client.get("/api/scans/a/history")) == ["a"]
    assert ids(client.get("/api/scans/foreign/history")) == ["foreign"]


def test_api_key_owner_scope(history):
    app, client, token = history
    seed(app, "a")
    seed(app, "foreign", owner_id="bob")
    headers = {"Authorization": "Bearer " + token}
    login(client, "admin")
    assert ids(client.get("/api/scans/a/history", headers=headers)) == ["a"]
    assert client.get("/api/scans/foreign/history", headers=headers).status_code == 404
    with app.state.db.session.begin() as s:
        key, write_token = issue_key(s, "alice", "write", scopes=["scan:write"])
        assert s.get(APIKey, key.id)
    assert (
        client.get(
            "/api/scans/a/history", headers={"Authorization": "Bearer " + write_token}
        ).status_code
        == 403
    )


def test_zip_root_not_filename(history):
    app, client, _ = history
    seed(app, "a", source_type="upload", source="same.zip")
    seed(app, "b", source_type="upload", source="renamed.zip", lineage_root_id="a")
    seed(app, "c", source_type="upload", source="same.zip")
    seed(app, "old", source_type="upload", source="same.zip", lineage_root_id=None)
    seed(
        app, "foreign", source_type="upload", source="same.zip", lineage_root_id="a", owner_id="bob"
    )
    assert ids(client.get("/api/scans/a/history")) == ["b", "a"]
    assert ids(client.get("/api/scans/old/history")) == ["old"]


def test_filters_and_page_count(history):
    app, client, _ = history
    for id in ("a", "b", "c"):
        seed(app, id)
    seed(app, "d", ref="release")
    seed(app, "e", profile="full")
    seed(app, "f", status="FAILED")
    response = client.get(
        "/api/scans/a/history?ref=main&profile=static&status=COMPLETED&page_size=2"
    )
    assert ids(response) == ["c", "b"]
    assert response.json() | {"items": []} == {"items": [], "total": 3, "page": 1, "page_size": 2}
    assert ids(
        client.get(
            "/api/scans/a/history?ref=main&profile=static&status=COMPLETED&page_size=2&page=2"
        )
    ) == ["a"]
    assert client.get("/api/scans/a/history?page_size=101").status_code == 422
    assert client.get("/api/scans/a/history?page=0").status_code == 422
    assert client.get("/api/scans/a/history?extra=x").status_code == 422
    assert client.get("/api/scans/a/history?ref=main&ref=main").status_code == 422


def test_history_explicit_review_projection_and_private_data(history):
    app, client, token = history
    seed(app, "a")
    with app.state.db.session.begin() as s:
        s.add(
            Review(
                id="review-a",
                job_id="a",
                requester_id="alice",
                reason="REQUEST-SECRET",
                decision_reason="DECISION-SECRET",
                status="rejected",
            )
        )
    response = client.get("/api/scans/a/history")
    row = response.json()["items"][0]
    assert row["review"] == {"id": "review-a", "status": "rejected", "workflow_state": "waiting"}
    for secret in ("SECRET", "previous_review_id", "next_review_id"):
        assert secret not in response.text
    assert row["coverage_complete"] is False
    assert row["engines"] == [{"name": "builtin", "status": "completed"}]
    assert (
        "review"
        not in client.get(
            "/api/scans/a/history", headers={"Authorization": "Bearer " + token}
        ).json()["items"][0]
    )
    with app.state.db.session.begin() as s:
        s.get(Review, "review-a").requester_id = "bob"
    assert "review" not in client.get("/api/scans/a/history").json()["items"][0]
    login(client, "admin")
    assert client.get("/api/scans/a/history").json()["items"][0]["review"]["id"] == "review-a"


def test_history_query_owner_ceiling(history):
    from aag.scan_history import history_query

    app, _, _ = history
    seed(app, "a")
    seed(app, "foreign", owner_id="bob")
    with app.state.db.session() as s:
        actor = Actor("alice", "alice", "admin", True, key_id="key", scopes=("scan:read",))
        with pytest.raises(HTTPException) as error:
            history_query(actor, s.get(Job, "foreign"))
        assert error.value.status_code == 404
        assert [j.id for j in s.scalars(history_query(actor, s.get(Job, "a")))] == ["a"]
