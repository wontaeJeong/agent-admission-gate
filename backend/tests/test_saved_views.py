import concurrent.futures
import os
import uuid
from threading import Barrier

import pytest
from aag.auth import Actor
from aag.db import Database
from aag.models import User
from conftest import login
from sqlalchemy import create_engine, text


def headers(people, name="alice"):
    return {"X-AAG-Account": people[name]["id"]}


def payload(name="Recent", **changes):
    return {
        "resource": "jobs",
        "name": name,
        "filters": {"version": 1, "scope": "personal"},
        **changes,
    }


def test_view_owner_isolation(client, people):
    login(client, "alice")
    created = client.post("/api/saved-views", headers=headers(people), json=payload())
    assert created.status_code == 201
    view = created.json()
    login(client, "bob")
    assert client.get("/api/saved-views?resource=jobs", headers=headers(people, "bob")).json() == []
    for method in (client.patch, client.delete):
        result = client.request(
            method.__name__.upper(),
            "/api/saved-views/" + view["id"],
            headers=headers(people, "bob"),
            json={"expected_revision": 1, **({"name": "other"} if method == client.patch else {})},
        )
        assert result.status_code == 404


def test_view_limit(client, people):
    login(client, "alice")
    for n in range(20):
        assert (
            client.post(
                "/api/saved-views", headers=headers(people), json=payload(str(n))
            ).status_code
            == 201
        )
    assert (
        client.post(
            "/api/saved-views",
            headers=headers(people),
            json=payload("21", resource="reviews", filters={"version": 1, "tab": "mine"}),
        ).status_code
        == 409
    )


def test_view_revision_conflict(client, people):
    login(client, "alice")
    a = client.post(
        "/api/saved-views", headers=headers(people), json=payload("a", is_default=True)
    ).json()
    b = client.post(
        "/api/saved-views", headers=headers(people), json=payload("b", is_default=True)
    ).json()
    views = client.get("/api/saved-views?resource=jobs", headers=headers(people)).json()
    assert next(v for v in views if v["id"] == a["id"])["revision"] == 2
    assert sum(v["is_default"] for v in views) == 1
    assert (
        client.patch(
            "/api/saved-views/" + a["id"],
            headers=headers(people),
            json={"expected_revision": 1, "name": "changed"},
        ).status_code
        == 409
    )
    assert (
        client.request(
            "DELETE",
            "/api/saved-views/" + b["id"],
            headers=headers(people),
            json={"expected_revision": 0},
        ).status_code
        == 422
    )
    assert (
        client.request(
            "DELETE",
            "/api/saved-views/" + b["id"],
            headers=headers(people),
            json={"expected_revision": 1},
        ).status_code
        == 200
    )


def test_view_validation_account_and_api_key_ceiling(client, people):
    login(client, "alice")
    for changes in (
        {"name": " "},
        {"name": "x" * 41},
        {"filters": {"version": 1, "page": 2}},
        {"filters": {"version": 1, "scroll": 42}},
        {"filters": {"version": 2}},
        {"filters": {"version": 1, "token": "secret"}},
        {"filters": {"version": 1, "days": 8}},
        {"filters": {"version": True}},
        {"is_default": "true"},
    ):
        assert (
            client.post(
                "/api/saved-views", headers=headers(people), json=payload(**changes)
            ).status_code
            == 422
        )
    assert client.post("/api/saved-views", json=payload()).status_code == 409
    assert client.get("/api/saved-views?resource=jobs").status_code == 409
    assert (
        client.post("/api/saved-views", headers=headers(people, "bob"), json=payload()).status_code
        == 409
    )
    auth = {**headers(people), "Authorization": "Bearer " + people["alice"]["token"]}
    assert client.get("/api/saved-views?resource=jobs", headers=auth).status_code == 403
    assert client.post("/api/saved-views", headers=auth, json=payload()).status_code == 403
    assert (
        client.post("/api/saved-views", headers=headers(people), json=payload()).status_code == 201
    )
    assert (
        client.post("/api/saved-views", headers=headers(people), json=payload()).status_code == 409
    )


def test_view_staff_scope_loss_is_reported(client, people, app):
    login(client, "reviewer")
    own = headers(people, "reviewer")
    assert (
        client.post(
            "/api/saved-views",
            headers=own,
            json=payload(filters={"version": 1, "scope": "review"}, is_default=True),
        ).status_code
        == 201
    )
    with app.state.db.session.begin() as s:
        s.get(User, people["reviewer"]["id"]).reviewer = False
    view = client.get("/api/saved-views?resource=jobs", headers=own).json()[0]
    assert view["usable"] is False
    assert view["invalid_reason"]
    assert view["filters"]["scope"] == "review"
    assert (
        client.patch(
            "/api/saved-views/" + view["id"],
            headers=own,
            json={"expected_revision": 1, "filters": {"version": 1, "scope": "personal"}},
        ).json()["usable"]
        is True
    )


@pytest.fixture(params=["sqlite", "postgresql"])
def race_db(request, tmp_path):
    schema = "aag_a3_" + uuid.uuid4().hex
    admin = None
    if request.param == "postgresql":
        url = os.environ.get("AAG_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("Set AAG_TEST_POSTGRES_URL to owned synthetic PostgreSQL")
        admin = create_engine(url)
        with admin.begin() as c:
            c.execute(text(f'CREATE SCHEMA "{schema}"'))
        url += ("&" if "?" in url else "?") + "options=-csearch_path%3D" + schema
    else:
        url = "sqlite:///" + str(tmp_path / "race.db")
    db = Database(url)
    db.create()
    with db.session.begin() as s:
        s.add(User(id="owner", subject="synthetic:a3", name="owner"))
    yield db
    db.engine.dispose()
    if admin:
        with admin.begin() as c:
            c.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def test_one_default_after_race(race_db):
    from aag.saved_views import change_view, create_view, list_views
    from fastapi import HTTPException

    a = Actor(id="owner", name="owner", role="user", reviewer=False)

    barrier = Barrier(2)

    def create(n):
        barrier.wait(timeout=10)
        with race_db.session.begin() as s:
            return create_view(s, a, payload(str(n), is_default=True))

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(create, range(2)))
    with race_db.session() as s:
        views = list_views(s, a, "jobs")
        assert sum(v["is_default"] for v in views) == 1
        assert sorted(v["revision"] for v in views) == [1, 2]

    def change(n):
        barrier.wait(timeout=10)
        try:
            with race_db.session.begin() as s:
                return change_view(
                    s,
                    a,
                    rows[1]["id"],
                    {
                        "expected_revision": next(
                            v["revision"] for v in views if v["id"] == rows[1]["id"]
                        ),
                        "name": "renamed-" + str(n),
                    },
                )
        except HTTPException as exc:
            return exc.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(r == 409 for r in results) == 1
    with race_db.session.begin() as s:
        for n in range(2, 19):
            create_view(s, a, payload(str(n)))

    def last(n):
        try:
            return create(100 + n)
        except HTTPException as exc:
            return exc.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(last, range(2)))
    assert sum(r == 409 for r in results) == 1
    with race_db.session() as s:
        assert len(list_views(s, a, "jobs")) == 20


def test_saved_views_migration_roundtrip(race_db):
    import subprocess
    import sys

    from aag.models import Base
    from sqlalchemy import inspect

    # This fixture owns a unique database/schema, never shared application data.
    Base.metadata.drop_all(race_db.engine)
    env = {**os.environ, "AAG_DATABASE_URL": str(race_db.engine.url)}

    def migrate(target, direction="upgrade"):
        subprocess.run(
            [sys.executable, "-m", "alembic", direction, target],
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        # External DDL replaces tables; discard pooled SQLite prepared statements.
        race_db.engine.dispose()

    migrate("head")
    assert "saved_views" in inspect(race_db.engine).get_table_names()
    with race_db.engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users (id, subject, name, role, reviewer, active, created_at) VALUES ('migration-owner', 'synthetic:migration', 'owner', 'user', false, true, 1)"
            )
        )
    migrate("d3222ac6ae74", "downgrade")
    assert "saved_views" not in inspect(race_db.engine).get_table_names()
    with race_db.engine.connect() as c:
        assert c.scalar(text("SELECT name FROM users WHERE id='migration-owner'")) == "owner"
    migrate("head")
    indexes = inspect(race_db.engine).get_indexes("saved_views")
    assert any(i["name"] == "uq_saved_views_default" and i["unique"] for i in indexes), indexes


def test_default_patch_and_delete_races(race_db):
    from aag.saved_views import change_view, create_view, delete_view, list_views
    from fastapi import HTTPException

    a = Actor(id="owner", name="owner", role="user", reviewer=False)
    with race_db.session.begin() as s:
        rows = [create_view(s, a, payload(str(n))) for n in range(2)]

    barrier = Barrier(2)

    def default(row):
        barrier.wait(timeout=10)
        try:
            with race_db.session.begin() as s:
                return change_view(s, a, row["id"], {"expected_revision": 1, "is_default": True})
        except HTTPException as e:
            return e.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(default, rows))
    assert all(isinstance(r, dict) or r == 409 for r in outcomes)
    with race_db.session() as s:
        latest = list_views(s, a, "jobs")
        assert sum(v["is_default"] for v in latest) == 1
    target = latest[0]

    def remove(_):
        barrier.wait(timeout=10)
        try:
            with race_db.session.begin() as s:
                return delete_view(s, a, target["id"], target["revision"])
        except HTTPException as e:
            return e.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(remove, range(2)))
    assert sum(r == 404 for r in outcomes) == 1
