"""The cookie account cannot silently submit a different account's open form."""

import pytest
from aag.models import APIKey, Comment, Job, Post
from conftest import login, package
from sqlalchemy import func, select


@pytest.mark.parametrize("kind", ["scan", "upload", "comment", "board", "key"])
def test_old_account_mutation_rejected(app, client, people, kind):
    login(client, "bob")
    with app.state.db.session.begin() as s:
        s.add(
            Job(
                id="owned-job",
                owner_id=people["bob"]["id"],
                source="example.zip",
                source_type="zip",
                profile="static",
                status="COMPLETED",
                verdict="REVIEW",
                result={},
            )
        )
    models = (Job, Comment, Post, APIKey)
    with app.state.db.session() as s:
        before = [s.scalar(select(func.count()).select_from(model)) for model in models]
    headers = {"X-AAG-Account": people["alice"]["id"]}
    if kind == "scan":
        response = client.post(
            "/api/scans",
            json={
                "url": "https://github.com/example/repo",
                "profile": "static",
            },
            headers=headers,
        )
    elif kind == "upload":
        response = client.post(
            "/api/scans/upload",
            files={"file": ("package.zip", package(), "application/zip")},
            data={"profile": "static"},
            headers=headers,
        )
    elif kind == "comment":
        response = client.post(
            "/api/scans/owned-job/comments",
            json={"body": "A note", "internal": False},
            headers=headers,
        )
    elif kind == "board":
        response = client.post(
            "/api/boards",
            json={"kind": "voc", "title": "A title", "body": "A body", "status": "open"},
            headers=headers,
        )
    else:
        response = client.post(
            "/api/api-keys",
            json={"name": "Old form", "days": 30, "scopes": ["scan:read"]},
            headers=headers,
        )
    assert response.status_code == 409, response.text
    with app.state.db.session() as s:
        assert [s.scalar(select(func.count()).select_from(model)) for model in models] == before


def test_legacy_profile_binding_is_optional_but_mismatch_is_rejected(client, people):
    login(client, "bob")
    assert client.put("/api/profile", json={"display_name": "Bob"}).status_code == 200
    assert (
        client.put(
            "/api/profile",
            json={"display_name": "Alice"},
            headers={"X-AAG-Account": people["alice"]["id"]},
        ).status_code
        == 409
    )
    assert client.get("/api/profile").json()["display_name"] == "Bob"
