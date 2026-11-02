import pytest
from aag.models import Job, Review
from conftest import login


@pytest.fixture
def completed_job(app, people):
    with app.state.db.session.begin() as s:
        job = Job(
            owner_id=people["alice"]["id"],
            source="synthetic-package.zip",
            source_type="upload",
            profile="static",
            status="COMPLETED",
            verdict="REVIEW",
            effective_verdict="REVIEW",
            result={"coverage_complete": True},
        )
        s.add(job)
        s.flush()
        return job.id


def test_scan_owner_gets_null_then_current_minimal_review_summary(
    client, app, people, completed_job
):
    login(client, "alice")
    response = client.get(f"/api/scans/{completed_job}")
    assert response.status_code == 200
    assert response.json()["review"] is None
    assert "no-store" in response.headers["cache-control"]

    with app.state.db.session.begin() as s:
        review = Review(
            job_id=completed_job,
            requester_id=people["alice"]["id"],
            reason="Synthetic requester context",
            decision_reason="Synthetic decision context",
        )
        s.add(review)
        s.flush()
        review_id = review.id

    for status in ("pending", "approved", "rejected"):
        with app.state.db.session.begin() as s:
            s.get(Review, review_id).status = status
        response = client.get(f"/api/scans/{completed_job}")
        assert response.json()["review"] == {"id": review_id, "status": status}


def test_review_summary_respects_scan_and_review_authorization(client, app, people, completed_job):
    with app.state.db.session.begin() as s:
        review = Review(
            job_id=completed_job,
            requester_id=people["alice"]["id"],
            reason="Private requester context",
            decision_reason="Private decision context",
        )
        s.add(review)
        s.flush()
        review_id = review.id

    login(client, "bob")
    assert client.get(f"/api/scans/{completed_job}").status_code == 404
    assert client.get(f"/api/reviews/{review_id}").status_code == 404
    assert (
        client.post(f"/api/scans/{completed_job}/review", json={"reason": "Another request"})
    ).status_code == 404

    login(client, "reviewer")
    staff_response = client.get(f"/api/scans/{completed_job}")
    assert staff_response.status_code == 200
    assert staff_response.json()["review"] == {"id": review_id, "status": "pending"}
    assert client.get(f"/api/reviews/{review_id}").status_code == 200
    assert (
        client.post(f"/api/scans/{completed_job}/review", json={"reason": "Another request"})
    ).status_code == 403

    login(client, "admin")
    assert client.get(f"/api/scans/{completed_job}").json()["review"] == {
        "id": review_id,
        "status": "pending",
    }

    key_headers = {"Authorization": "Bearer " + people["alice"]["token"]}
    key_response = client.get(f"/api/scans/{completed_job}", headers=key_headers)
    assert key_response.status_code == 200
    assert "review" not in key_response.json()
    assert client.get(f"/api/reviews/{review_id}", headers=key_headers).status_code == 403
    assert (
        client.post(
            f"/api/scans/{completed_job}/review",
            json={"reason": "Another request"},
            headers=key_headers,
        ).status_code
        == 403
    )


def test_scan_owner_cannot_see_a_review_owned_by_someone_else(client, app, people, completed_job):
    with app.state.db.session.begin() as s:
        s.add(
            Review(
                job_id=completed_job,
                requester_id=people["bob"]["id"],
                reason="Private requester context",
            )
        )
    login(client, "alice")
    assert client.get(f"/api/scans/{completed_job}").json()["review"] is None
    response = client.post(
        f"/api/scans/{completed_job}/review", json={"reason": "Synthetic request"}
    )
    assert response.status_code == 409
    assert "exists" not in response.json()["detail"].lower()


def test_concurrent_review_requests_produce_one_review_and_a_conflict(
    client, app, people, completed_job
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock

    from sqlalchemy import event, select

    login(client, "alice")
    barrier = Barrier(2)
    lock = Lock()
    checked = 0

    def synchronize_duplicate_check(conn, cursor, statement, parameters, context, executemany):
        nonlocal checked
        if statement.lstrip().upper().startswith("SELECT") and "FROM reviews" in statement:
            with lock:
                checked += 1
                first_checks = checked <= 2
            if first_checks:
                barrier.wait(timeout=10)

    event.listen(app.state.db.engine, "before_cursor_execute", synchronize_duplicate_check)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(
                    client.post,
                    f"/api/scans/{completed_job}/review",
                    json={"reason": "Synthetic review request"},
                )
                for _ in range(2)
            ]
            responses = [future.result(timeout=15) for future in futures]
    finally:
        event.remove(app.state.db.engine, "before_cursor_execute", synchronize_duplicate_check)

    assert sorted(response.status_code for response in responses) == [201, 409]
    with app.state.db.session() as s:
        reviews = list(s.scalars(select(Review).where(Review.job_id == completed_job)))
        assert len(reviews) == 1
