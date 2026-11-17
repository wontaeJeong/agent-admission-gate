from aag.models import Audit
from sqlalchemy import select
from test_review_claims import workflow  # noqa: F401


def test_events_owner_visibility(workflow):  # noqa: F811 - imported parametrized fixture
    app, client, call = workflow
    assert call("one", "claim").status_code == 200
    assert call("ops", "release", 2, reason="Operational reassignment").status_code == 200
    assert call("two", "claim", 3).status_code == 200
    assert (
        call("two", "decision", 4, decision="rejected", reason="Review completed").status_code
        == 200
    )

    def events(name, query=""):
        return client.get(
            "/api/reviews/review/events" + query, headers={"Cookie": "aag_session=" + name}
        )

    assert events("other").status_code == 404
    rows = events("owner").json()
    assert [r["kind"] for r in rows["items"]] == ["claim", "release", "claim", "rejected"]
    assert rows["items"][0]["reason"] is None
    assert rows["items"][1]["reason"] == "Operational reassignment"
    first = events("owner", "?page_size=2").json()
    second = events("owner", "?page_size=2&after=" + first["next_cursor"]).json()
    assert [r["id"] for r in first["items"] + second["items"]] == [r["id"] for r in rows["items"]]
    assert second["next_cursor"] is None
    numbered = events("owner", "?page=2&page_size=2").json()
    assert numbered["items"] == second["items"]
    assert numbered["page"] == 2
    assert numbered["page_size"] == 2
    assert events("owner", "?page=0").status_code == 422
    assert events("owner", "?page=2&after=" + first["next_cursor"]).status_code == 422
    app.state.settings.review_workflow_enabled = False
    assert events("owner").status_code == 200
    with app.state.db.session() as s:
        assert len(list(s.scalars(select(Audit).where(Audit.target_id == "review")))) == 4
