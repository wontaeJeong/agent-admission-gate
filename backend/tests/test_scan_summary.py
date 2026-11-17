from html import unescape

from aag.auth import issue_key
from aag.models import APIKey, Comment, Job, Review
from aag.scan_summary import build_scan_summary
from conftest import login
from sqlalchemy import select


def finding(**kw):
    return dict(
        severity="high", engine="builtin", rule="RULE", title="Finding", path="a.py", line=1, **kw
    )


def public_job(findings=None):
    return dict(
        id="summary-job",
        source="package.zip",
        ref="main",
        resolved_commit="a" * 40,
        content_hash="b" * 64,
        created_at=0,
        profile="static",
        status="COMPLETED",
        verdict="BLOCK",
        effective_verdict="REVIEW",
        coverage_complete=False,
        limitations=["Static analysis only."],
        engines=[dict(name="builtin", status="failed")],
        findings=findings or [],
    )


def seed(app, people):
    with app.state.db.session.begin() as s:
        j = Job(
            id="summary-job",
            owner_id=people["alice"]["id"],
            source="package.zip",
            source_type="upload",
            profile="static",
            status="COMPLETED",
            verdict="BLOCK",
            effective_verdict="REVIEW",
            error="ORIGINAL-ERROR-SECRET",
            result={
                "coverage_complete": False,
                "findings": [finding()],
                "raw": "RAW-SECRET",
                "engines": [
                    {"name": "builtin", "status": "failed", "error": "ENGINE-ERROR-SECRET"}
                ],
            },
        )
        s.add(j)
        s.flush()
        s.add(
            Review(
                job_id=j.id,
                requester_id=j.owner_id,
                status="rejected",
                reason="DRAFT-REASON",
                decision_reason="PUBLIC-DECISION",
            )
        )
        s.add(
            Comment(
                target_type="scan",
                target_id=j.id,
                author_id=j.owner_id,
                internal=True,
                body="INTERNAL-COMMENT",
            )
        )


def test_summary_api_key_omits_review(app, client, people):
    seed(app, people)
    response = client.get(
        "/api/scans/summary-job/summary?format=markdown",
        headers={"Authorization": "Bearer " + people["alice"]["token"]},
    )
    assert response.status_code == 200
    assert "text/markdown" in response.headers["content-type"]
    assert 'attachment; filename="scan-summary-job.md"' == response.headers["content-disposition"]
    assert "Review" not in response.text
    assert "PUBLIC-DECISION" not in unescape(response.text)
    assert "rejected" not in response.text


def test_summary_internal_comment_absent(app, client, people):
    seed(app, people)
    login(client, "alice")
    response = client.get("/api/scans/summary-job/summary?format=markdown")
    assert response.status_code == 200
    assert "Decision reason:" in response.text
    assert "PUBLIC-DECISION" in unescape(response.text)
    for secret in ["INTERNAL", "DRAFT", "ORIGINAL", "ENGINE-ERROR", "RAW-SECRET"]:
        assert secret not in unescape(response.text)
    assert "Read-only" in response.text
    # Job access alone does not authorize another requester's review details.
    with app.state.db.session.begin() as s:
        s.scalar(select(Review).where(Review.job_id == "summary-job")).requester_id = people["bob"][
            "id"
        ]
    hidden = client.get("/api/scans/summary-job/summary")
    assert hidden.status_code == 200
    assert "## 검토 / Review" not in hidden.text
    assert "PUBLIC-DECISION" not in unescape(hidden.text)
    login(client, "reviewer")
    visible = client.get("/api/scans/summary-job/summary")
    assert visible.status_code == 200
    assert "Decision reason:" in visible.text
    assert "PUBLIC-DECISION" in unescape(visible.text)


def test_summary_authorization_and_strict_query(app, client, people):
    seed(app, people)
    login(client, "bob")
    assert client.get("/api/scans/summary-job/summary").status_code == 404
    assert client.get("/api/scans/unknown/summary").status_code == 404
    login(client, "alice")
    assert client.get("/api/scans/summary-job/summary?format=html").status_code == 422
    assert client.get("/api/scans/summary-job/summary?extra=secret").status_code == 422
    assert (
        client.get("/api/scans/summary-job/summary?format=markdown&format=markdown").status_code
        == 422
    )
    with app.state.db.session.begin() as s:
        key, token = issue_key(s, people["alice"]["id"], "write-only")
        s.get(APIKey, key.id).scopes = ["scan:write"]
    assert (
        client.get(
            "/api/scans/summary-job/summary", headers={"Authorization": "Bearer " + token}
        ).status_code
        == 403
    )


def test_summary_escapes_untrusted_markdown():
    job = public_job([finding()])
    job["findings"][0]["title"] = "<img src=x> [click](javascript:alert(1)) https://evil.test"
    job["source"] = "https://user:SOURCE-SECRET@example.test/a?token=QUERY-SECRET#FRAGMENT-SECRET"
    job["error"] = "ERROR-SECRET"
    text = build_scan_summary(job, public_url="https://gate.example")
    assert "` <img src=x> [click](javascript:alert(1)) https://evil.test `" in text
    for secret in ["SOURCE-SECRET", "QUERY-SECRET", "FRAGMENT-SECRET", "ERROR-SECRET"]:
        assert secret not in unescape(text)
    assert "[원본 검사 열기 / Open original scan](https://gate.example/jobs/summary-job)" in text


def test_summary_twenty_and_omitted_count():
    findings = [
        dict(finding(), title=f"item {n:02}", severity="low", line=30 - n) for n in range(24)
    ]
    findings.append(dict(finding(), title="critical first", severity="critical"))
    text = build_scan_summary(public_job(findings), public_url="https://gate.example")
    assert "Total findings: 25" in text
    assert "Omitted findings: 5" in text
    assert "1970-01-01 00:00:00 UTC" in text
    assert "Coverage: incomplete" in text
    assert text.index("critical first") < text.index("item 23") < text.index("item 22")
    assert "item 05" in text and "item 04" not in text
    assert "Original verdict: BLOCK" in text and "Final verdict: REVIEW" in text
    assert "low: 24" in text and "critical: 1" in text
