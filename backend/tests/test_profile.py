from conftest import login


def test_profile_name_is_private_and_independent_from_account_identity(client, people):
    login(client, "alice")
    initial = client.get("/api/profile")
    assert initial.status_code == 200
    assert initial.json()["account_name"] == "alice"
    assert initial.json()["display_name"] is None

    saved = client.put("/api/profile", json={"display_name": "  Alice example  "})
    assert saved.status_code == 200
    assert saved.json()["display_name"] == "Alice example"
    assert client.get("/api/auth/me").json()["name"] == "alice"

    login(client, "bob")
    assert client.get("/api/profile").json()["display_name"] is None
    login(client, "alice")
    assert client.get("/api/profile").json()["display_name"] == "Alice example"
    assert client.put("/api/profile", json={"display_name": None}).json()["display_name"] is None


def test_profile_rejects_invalid_names_and_api_key_access(client, people):
    login(client, "alice")
    for value in (" ", "a" * 81, "bad\nname"):
        assert client.put("/api/profile", json={"display_name": value}).status_code == 422
    assert (
        client.put("/api/profile", json={"display_name": "x", "user_id": "other"}).status_code
        == 422
    )
    auth = {"Authorization": "Bearer " + people["alice"]["token"]}
    assert client.get("/api/profile", headers=auth).status_code == 403
    assert client.put("/api/profile", json={"display_name": "x"}, headers=auth).status_code == 403
