import pytest
from aag.models import Job, Review
from conftest import login
from sqlalchemy import select


def seed(app, people):
    with app.state.db.session.begin() as s:
        for name in ("alice", "bob"):
            job = Job(
                id=name + "-scan",
                owner_id=people[name]["id"],
                source=name + "/CVE-2026-1234_100%.zip",
                source_type="upload",
                profile="static",
                status="COMPLETED",
                verdict="BLOCK",
                effective_verdict="BLOCK",
                result={
                    "findings": [
                        {
                            "fingerprint": "duplicate",
                            "engine": "scanner",
                            "rule": "CVE-2026-1234",
                            "title": title,
                            "path": "src/100%.py",
                            "severity": "high",
                            "action": "BLOCK",
                        }
                        for title in ["first", "needle second"]
                    ]
                },
            )
            s.add(job)
        s.flush()
        s.add(
            Review(
                id="bob-review",
                job_id="bob-scan",
                requester_id=people["bob"]["id"],
                reason="needle request",
                decision_reason="needle decision",
            )
        )
    object.__setattr__(app.state.settings, "search_enabled", True)


def search(client, **params):
    return client.get("/api/search", params={"q": "needle", "type": "findings", **params})


def index_all(app):
    from aag.search_index import index_job_findings

    with app.state.db.session.begin() as s:
        for job in s.scalars(select(Job)):
            index_job_findings(s, job)


def test_hidden_job_absent_from_items_total_cursor(app, client, people):
    seed(app, people)
    index_all(app)
    login(client, "alice")
    first = search(client, page_size=1).json()
    assert first["total"] == 1
    assert first["next_cursor"] is None
    assert [x["id"] for x in first["items"]] == ["alice-scan:1"]
    assert "bob" not in str(first)
    assert "occurrence=1" in first["items"][0]["href"]
    assert set(first["items"][0]) == {"kind", "id", "label", "safe_snippet", "href"}


def test_reviewer_scope_matches_source_query(app, client, people):
    seed(app, people)
    index_all(app)
    login(client, "reviewer")
    response = search(client, scope="review").json()
    source = client.get("/api/scans", params={"scope": "review"}).json()
    assert [i["id"].split(":")[0] for i in response["items"]] == [i["id"] for i in source["items"]]
    assert response["total"] == 1
    login(client, "alice")
    assert search(client, scope="review").status_code == 403
    assert search(client, scope="all").status_code == 403


def test_api_key_search_forbidden(app, client, people):
    seed(app, people)
    r = client.get(
        "/api/search?q=needle", headers={"Authorization": "Bearer " + people["alice"]["token"]}
    )
    assert r.status_code == 403


def test_literal_percent_and_underscore(app, client, people):
    seed(app, people)
    index_all(app)
    login(client, "alice")
    assert search(client, q="100%").json()["total"] == 2
    assert search(client, q="100_").json()["total"] == 0
    assert search(client, q="needle CVE-2026").json()["total"] == 1
    assert search(client, q="needle absent").json()["total"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"q": "x"},
        {"q": "x" * 201},
        {"q": "a b c d e f g h i"},
        {"page_size": 51},
        {"type": "unknown"},
        {"extra": "unknown"},
        {"cursor": "invalid"},
    ],
)
def test_query_length_and_tokens(app, client, people, params):
    seed(app, people)
    assert search(client, **params).status_code == 422


def test_index_pending_not_zero(app, client, people):
    seed(app, people)
    login(client, "alice")
    result = search(client).json()
    assert result["index_complete"] is False
    assert result["total"] is None
    index_all(app)
    with app.state.db.session.begin() as s:
        s.get(Job, "bob-scan").finding_index_version = None
    assert search(client).json()["index_complete"] is True


def test_current_verdict_from_job_join(app, client, people):
    seed(app, people)
    index_all(app)
    login(client, "alice")
    with app.state.db.session.begin() as s:
        s.get(Job, "alice-scan").effective_verdict = "ALLOW"
    assert "ALLOW" in search(client).json()["items"][0]["safe_snippet"]


def test_flag_and_live_permission_change(app, client, people):
    seed(app, people)
    index_all(app)
    login(client, "reviewer")
    assert search(client, scope="all").json()["total"] == 2
    from aag.models import User

    with app.state.db.session.begin() as s:
        s.get(User, people["reviewer"]["id"]).reviewer = False
    assert search(client, scope="all").status_code == 403
    app.state.settings.search_enabled = False
    assert search(client).status_code == 404


def test_cursor_pages_no_duplicates_and_bound_to_query(app, client, people):
    seed(app, people)
    index_all(app)
    login(client, "alice")
    a = search(client, q="CVE-2026", page_size=1).json()
    b = search(client, q="CVE-2026", page_size=1, cursor=a["next_cursor"]).json()
    assert len({a["items"][0]["id"], b["items"][0]["id"]}) == 2
    assert b["next_cursor"] is None
    assert search(client, q="different", cursor=a["next_cursor"]).status_code == 422
    login(client, "bob")
    assert search(client, q="CVE-2026", cursor=a["next_cursor"]).status_code == 422


def test_scans_reviews_and_private_fields(app, client, people):
    from aag.models import Comment

    seed(app, people)
    index_all(app)
    with app.state.db.session.begin() as s:
        job = s.get(Job, "alice-scan")
        job.ref = "release/needle"
        job.resolved_commit = "deadbeef" * 5
        job.error = "private-error-only"
        s.add(
            Comment(
                target_type="job",
                target_id=job.id,
                author_id=people["alice"]["id"],
                body="private-comment-only",
                internal=True,
            )
        )
    login(client, "alice")
    assert search(client, type="scans", q="release needle").json()["total"] == 1
    assert search(client, type="scans", q="deadbeef").json()["total"] == 1
    for kind in ("scans", "reviews", "findings"):
        assert search(client, type=kind, q="private").json()["total"] == 0
    assert search(client, type="reviews").json()["total"] == 0
    login(client, "bob")
    review = search(client, type="reviews", q="needle decision").json()
    assert review["total"] == 1
    assert review["items"][0]["href"] == "/reviews/bob-review"


def test_missing_and_old_projection_stays_incomplete(app, client, people):
    seed(app, people)
    index_all(app)
    login(client, "alice")
    with app.state.db.session.begin() as s:
        job = s.get(Job, "alice-scan")
        job.finding_index_version = 0
    assert search(client).json()["total"] is None
    assert search(client).json()["items"] == []


def test_obsolete_rows_do_not_masquerade_as_complete(app, client, people):
    from aag.models import FindingIndex

    seed(app, people)
    index_all(app)
    login(client, "alice")
    with app.state.db.session.begin() as s:
        s.get(FindingIndex, ("alice-scan", 1)).schema_version = 0
    result = search(client).json()
    assert result["index_complete"] is False
    assert result["total"] is None


@pytest.mark.parametrize("position", [10**100, -1, True])
def test_cursor_rejects_unbounded_ordinals(app, client, people, position):
    import base64
    import json

    from aag.auth import Actor
    from aag.routes_search import cursor_key

    seed(app, people)
    index_all(app)
    login(client, "alice")
    with app.state.db.session() as s:
        created = s.get(Job, "alice-scan").created_at
    key = cursor_key(
        Actor(people["alice"]["id"], "Alice", "user", False), "findings", "personal", ["needle"]
    )
    cursor = base64.urlsafe_b64encode(
        json.dumps([key, created, "alice-scan", position]).encode()
    ).decode()
    assert search(client, cursor=cursor).status_code == 422


def test_finding_review_projection_obeys_review_visibility(app, client, people):
    seed(app, people)
    index_all(app)
    with app.state.db.session.begin() as s:
        s.add(
            Review(
                id="different-requester",
                job_id="alice-scan",
                requester_id=people["bob"]["id"],
                reason="hidden",
                status="rejected",
            )
        )
    login(client, "alice")
    assert client.get("/api/reviews/different-requester").status_code == 404
    assert "rejected" not in search(client).json()["items"][0]["safe_snippet"]
