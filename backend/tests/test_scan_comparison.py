"""Stored evidence comparison must preserve uncertainty and both-side authorization."""

from copy import deepcopy
from types import SimpleNamespace

import pytest
from aag.policy import finding
from fastapi import HTTPException
from test_scan_history import history, seed  # noqa: F401


def job(id="old", findings=None, **kw):
    values = dict(
        id=id,
        owner_id="alice",
        source_type="git",
        source="https://github.com/example/repo.git",
        profile="static",
        status="COMPLETED",
        ref="main",
        resolved_commit=None,
        target_commit=None,
        created_at=1,
        verdict="BLOCK",
        effective_verdict="BLOCK",
        content_hash=None,
        lineage_root_id=id,
        result={
            "findings": findings or [],
            "coverage_complete": True,
            "policy_version": "v1",
            "scanner_revision": "r1",
            "engines": [{"name": "builtin", "required": True, "status": "completed"}],
        },
    )
    values.update(kw)
    return SimpleNamespace(**values)


def compare(baseline, current, **kw):
    from aag.scan_comparison import compare_jobs

    return compare_jobs(baseline, current, **kw)


def f(line=1, **kw):
    return finding("builtin", "rule", "high", "Synthetic finding", path="file.py", line=line) | kw


def test_identical_fingerprint_persists():
    result = compare(job(findings=[f(), f()]), job("new", [f(), f()]))
    assert result["summary"]["persisting"] == 2
    assert len(result["items"]) == 2
    assert all(x["confidence"] == "exact" for x in result["items"])


def test_line_move_is_candidate():
    item = compare(job(findings=[f()]), job("new", [f(12)]))["items"][0]
    assert item["classification"] == "moved_candidate"
    assert item["confidence"] == "candidate"


def test_ambiguous_match_stays_unmatched():
    result = compare(job(findings=[f(1), f(2)]), job("new", [f(3)]))
    assert result["summary"]["unmatched"] == 3
    assert len(result["items"]) == 3
    assert sum(x["baseline_finding"] is not None for x in result["items"]) == 2


def test_exception_is_not_remediation():
    result = compare(job(findings=[f()]), job("new", [f(suppressed=True, severity="low")]))
    assert result["summary"]["persisting"] == 1
    assert result["items"][0]["change_flags"] == ["severity_changed", "suppression_changed"]
    assert "resolved" not in result["summary"]


def test_incomplete_engine_has_no_resolved_count():
    current = job("new")
    current.result["coverage_complete"] = False
    current.result["engines"][0]["status"] = "failed"
    result = compare(job(findings=[f()]), current)
    assert result["comparability"]["coverage_complete"] is False
    assert result["summary"]["not_observed"] == 1
    assert "resolved" not in result["summary"]


def test_missing_provenance_is_unknown():
    result = compare(job(), job("new"))
    assert result["comparability"]["provenance_known"] is False
    assert result["baseline"]["engines"][0]["engine_version"] is None
    assert result["baseline"]["engines"][0]["database_version"] is None
    assert result["comparability"]["same_scanner_revision"] is True
    old = job(result={})
    assert compare(old, job("new"))["comparability"]["same_policy"] is None


@pytest.mark.parametrize("status", ["FAILED", "CANCELLED"])
def test_failed_cancelled_only_metadata(status):
    result = compare(job(findings=[f()]), job("new", [f()], status=status))
    assert result["items"] == []
    assert result["summary"] is None


@pytest.mark.parametrize("status", ["PENDING", "RUNNING"])
def test_unfinished_conflict(status):
    with pytest.raises(HTTPException) as error:
        compare(job(), job("new", status=status))
    assert error.value.status_code == 409


@pytest.mark.parametrize(
    "change",
    [
        {"owner_id": "bob"},
        {"source_type": "upload"},
        {"source": "https://github.com/example/other.git"},
    ],
)
def test_incompatible_targets(change):
    with pytest.raises(HTTPException) as error:
        compare(job(), job("new", **change), allow_unlinked=True)
    assert error.value.status_code == 422


def test_unlinked_zip_requires_confirmation_and_preserves_warning():
    baseline, current = job(source_type="upload"), job("new", source_type="upload")
    with pytest.raises(HTTPException) as error:
        compare(baseline, current)
    assert error.value.status_code == 422
    assert error.value.detail["code"] == "unlinked_zip"
    result = compare(baseline, current, allow_unlinked=True)
    assert result["comparability"]["same_source"] is False
    current.lineage_root_id = "old"
    assert compare(baseline, current)["comparability"]["same_source"] is True


def test_differences_and_bounded_thousand_items_are_read_only():
    baseline = job(findings=[f(n) for n in range(1000)])
    current = job("new", [f(n) for n in range(500, 1500)], profile="full")
    current.result["policy_version"] = "v2"
    current.result["scanner_revision"] = "r2"
    before = deepcopy((baseline.__dict__, current.__dict__))
    result = compare(baseline, current)
    assert result["summary"] == {
        "persisting": 500,
        "moved_candidate": 0,
        "new": 0,
        "not_observed": 0,
        "unmatched": 1000,
    }
    assert result["comparability"]["same_profile"] is False
    assert result["comparability"]["same_policy"] is False
    assert result["comparability"]["same_scanner_revision"] is False
    assert (baseline.__dict__, current.__dict__) == before


def test_one_sided_findings_and_missing_fingerprint():
    current = job("new", [f(rule="different", fingerprint="different")])
    result = compare(job(findings=[f()]), current)
    assert result["summary"]["new"] == 1
    assert result["summary"]["not_observed"] == 1
    result = compare(job(findings=[f(fingerprint=None)]), job("new", [f(fingerprint=None)]))
    assert result["summary"]["unmatched"] == 2


def test_other_side_hidden(history):  # noqa: F811
    app, client, token = history
    seed(app, "old")
    seed(app, "new")
    seed(app, "hidden", owner_id="bob")
    for path in (
        "/api/scans/new/compare?baseline_id=hidden",
        "/api/scans/hidden/compare?baseline_id=old",
    ):
        response = client.get(path)
        assert response.status_code == 404
        assert "source" not in response.text
    response = client.get("/api/scans/new/compare?baseline_id=old")
    assert response.status_code == 200
    assert "SECRET" not in response.text
    assert "review" not in response.text
    assert client.get("/api/scans/new/compare?baseline_id=old&extra=1").status_code == 422
    assert client.get("/api/scans/new/compare?baseline_id=old&baseline_id=old").status_code == 422
    headers = {"Authorization": "Bearer " + token}
    assert (
        client.get("/api/scans/hidden/compare?baseline_id=old", headers=headers).status_code == 404
    )


def test_canonical_git_identity_and_unsafe_legacy_url():
    assert compare(job(), job("new", source="https://GITHUB.com/example/repo"))["comparability"][
        "same_source"
    ]
    with pytest.raises(HTTPException) as error:
        compare(job(), job("new", source="https://private-token@github.com/example/repo"))
    assert error.value.status_code == 422
    assert "private-token" not in str(error.value.detail)


@pytest.mark.parametrize(
    "engines",
    [
        [{"name": "builtin", "required": True, "status": "completed", "truncated": 2}],
        [{"name": "builtin", "required": True, "status": "failed"}],
        [{"name": "builtin", "required": True, "status": "unavailable"}],
        [{"name": "llm", "required": True, "status": "failed"}],
        [],
        ["invalid"],
    ],
)
def test_reported_complete_cannot_hide_engine_failure(engines):
    current = job("new")
    current.result["engines"] = engines
    assert compare(job(), current)["comparability"]["coverage_complete"] is False


def test_missing_or_malformed_findings_cannot_claim_complete_coverage():
    current = job("new")
    current.result.pop("findings")
    assert compare(job(), current)["comparability"]["coverage_complete"] is False
    current.result["findings"] = [None]
    assert compare(job(), current)["comparability"]["coverage_complete"] is False


def test_api_scope_ceiling_and_no_domain_changes(history):  # noqa: F811
    from aag.auth import issue_key
    from aag.models import Job, Review, User
    from conftest import login
    from sqlalchemy import select

    app, client, token = history
    seed(app, "old", result=job(findings=[f()]).result)
    seed(app, "new", result=job("new", [f(suppressed=True)]).result)
    seed(app, "foreign", owner_id="bob")
    with app.state.db.session.begin() as s:
        s.get(User, "alice").role = "admin"
        s.add(Review(id="review-new", job_id="new", requester_id="alice", reason="PRIVATE-REASON"))
        _, write_token = issue_key(s, "alice", "write-only", scopes=["scan:write"])
    login(client, "admin")
    assert client.get("/api/scans/foreign/compare?baseline_id=old").status_code == 422
    assert (
        client.get(
            "/api/scans/new/compare?baseline_id=old",
            headers={"Authorization": "Bearer " + write_token},
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/api/scans/foreign/compare?baseline_id=old",
            headers={"Authorization": "Bearer " + token},
        ).status_code
        == 404
    )
    response = client.get(
        "/api/scans/new/compare?baseline_id=old", headers={"Authorization": "Bearer " + token}
    )
    assert response.status_code == 200
    assert "review" not in response.text
    assert "PRIVATE" not in response.text
    with app.state.db.session() as s:
        assert s.get(Job, "new").effective_verdict == "REVIEW"
        assert s.get(Job, "new").result["findings"][0]["suppressed"] is True
        assert s.scalar(select(Review).where(Review.id == "review-new")).revision == 1
