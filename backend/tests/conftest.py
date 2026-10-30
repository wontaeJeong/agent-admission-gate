import io
import zipfile

import pytest
from aag.auth import issue_key, password_hash
from aag.config import Settings
from aag.main import create_app
from aag.models import User
from fastapi.testclient import TestClient


@pytest.fixture
def app(tmp_path):
    settings = Settings(
        environment="test",
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        bootstrap_password="test-password-long",
        public_url="http://localhost:8000",
        boards_enabled=True,
    )
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(
        app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:8000"}
    ) as c:
        assert (
            c.post(
                "/api/auth/login", json={"username": "admin", "password": "test-password-long"}
            ).status_code
            == 200
        )
        yield c


@pytest.fixture
def people(app, client):
    result = {}
    with app.state.db.session.begin() as s:
        for name, reviewer in [("alice", False), ("bob", False), ("reviewer", True)]:
            u = User(
                subject="local:" + name,
                name=name,
                role="user",
                reviewer=reviewer,
                password_hash=password_hash("test-password-long"),
            )
            s.add(u)
            s.flush()
            _, token = issue_key(s, u.id, "test")
            result[name] = {"id": u.id, "token": token}
    return result


def login(client, name):
    response = client.post(
        "/api/auth/login", json={"username": name, "password": "test-password-long"}
    )
    assert response.status_code == 200


def package(files=None):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        for path, content in (files or {"readme.md": "A read-only documentation package."}).items():
            z.writestr(path, content)
    return data.getvalue()


def upload(client, files=None, profile="static", **kw):
    response = client.post(
        "/api/scans/upload",
        files={"file": ("package.zip", package(files), "application/zip")},
        data={"profile": profile},
        **kw,
    )
    assert response.status_code == 202, response.text
    return response.json()["id"]


def wait_job(client, job_id, **kw):
    import time

    for _ in range(100):
        r = client.get("/api/scans/" + job_id, **kw)
        assert r.status_code == 200, r.text
        j = r.json()
        if j["status"] not in {"PENDING", "RUNNING"}:
            return j
        time.sleep(0.03)
    raise AssertionError("Job did not finish")
