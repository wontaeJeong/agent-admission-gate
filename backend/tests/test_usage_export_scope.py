import csv
import io
import time

from aag.models import Usage
from conftest import login


def test_export_matches_dashboard_scope_and_utc_window(client, app, people):
    owner = client.get("/api/auth/me").json()["id"]
    cutoff = (int(time.time() // 86400) - 6) * 86400
    with app.state.db.session.begin() as s:
        s.add_all(
            [
                Usage(user_id=owner, kind="llm", provider="mine", created_at=cutoff + 1),
                Usage(
                    user_id=people["alice"]["id"],
                    kind="llm",
                    provider="other",
                    created_at=cutoff + 1,
                ),
                Usage(user_id=owner, kind="llm", provider="too-old", created_at=cutoff - 1),
            ]
        )

    def providers(scope):
        response = client.get(f"/api/usage/export?days=7&scope={scope}")
        assert response.status_code == 200
        return {
            r["provider"] for r in csv.DictReader(io.StringIO(response.text)) if r["kind"] == "llm"
        }

    assert providers("personal") == {"mine"}
    assert providers("all") == {"mine", "other"}
    default = client.get("/api/usage/export?days=7")
    assert "other" not in default.text
    assert client.get("/api/usage/export?days=1&scope=all").status_code == 200
    login(client, "alice")
    assert client.get("/api/usage/export?days=7&scope=all").status_code == 403
    assert client.get("/api/usage/export?days=7&scope=review").status_code == 403
    login(client, "reviewer")
    assert providers("review") == set()
    assert (
        client.get(
            "/api/usage/export?scope=all",
            headers={"Authorization": "Bearer " + people["reviewer"]["token"]},
        ).status_code
        == 403
    )
