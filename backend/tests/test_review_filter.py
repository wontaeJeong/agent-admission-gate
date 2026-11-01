from aag.models import Job, Review
from conftest import login


def test_my_pending_reviews_filter_is_owner_scoped(client, app, people):
    with app.state.db.session.begin() as s:
        for user, status in [("alice", "pending"), ("alice", "approved"), ("bob", "pending")]:
            job = Job(
                owner_id=people[user]["id"],
                source=f"{user}-{status}",
                source_type="git",
                profile="static",
            )
            s.add(job)
            s.flush()
            s.add(
                Review(
                    job_id=job.id,
                    requester_id=people[user]["id"],
                    reason="review please",
                    status=status,
                )
            )
    login(client, "alice")
    response = client.get("/api/reviews?tab=mine&status=pending")
    assert response.status_code == 200
    assert [item["source"] for item in response.json()["items"]] == ["alice-pending"]
