import json
import time

from aag.auth import digest, issue_key
from aag.config import Settings
from aag.models import APIKey, Session, User


def test_api_keys_are_disabled_by_default(app, client, monkeypatch):
    monkeypatch.delenv("AAG_API_KEYS_ENABLED", raising=False)
    app.state.settings.api_keys_enabled = Settings(_env_file=None).api_keys_enabled
    assert (
        client.post(
            "/api/auth/login", json={"username": "admin", "password": "test-password-long"}
        ).status_code
        == 200
    )
    assert client.get("/api/scans").status_code == 200
    with app.state.db.session.begin() as s:
        user = s.query(User).filter_by(subject="local:admin").one()
        _, token = issue_key(s, user.id, "existing")
    assert client.post("/api/api-keys", json={"name": "new"}).status_code == 503
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 503
    assert client.post("/api/device-clients", json={"name": "client"}).status_code == 503


def test_unconfigured_oidc_preserves_interactive_sessions_but_blocks_existing_keys(app, client):
    settings = app.state.settings
    settings.auth_mode = "oidc"
    settings.oidc_issuer = "https://identity.example.test/realms/workspace"
    settings.api_keys_enabled = True
    with app.state.db.session.begin() as s:
        user = User(subject=settings.oidc_issuer + "|subject-1", name="user", role="user")
        s.add(user)
        s.flush()
        s.add(
            Session(digest=digest("session-token"), user_id=user.id, expires_at=time.time() + 600)
        )
        _, token = issue_key(s, user.id, "existing")
    cookie = {"Cookie": "aag_session=session-token"}
    assert client.get("/api/auth/me", headers=cookie).status_code == 200
    assert client.post("/api/api-keys", json={"name": "new"}, headers=cookie).status_code == 503
    assert (
        client.post("/api/device-clients", json={"name": "new"}, headers=cookie).status_code == 503
    )
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 503


def test_local_session_cannot_bypass_oidc_after_auth_mode_changes(app, client):
    settings = app.state.settings
    settings.auth_mode = "oidc"
    settings.oidc_issuer = "https://identity.example.test/realms/workspace"
    assert client.get("/api/auth/me").status_code == 401


def setup_keycloak(app, monkeypatch, *, role="admin", reviewer=True):
    import httpx
    from aag import identity_lifecycle
    from pydantic import SecretStr

    settings = app.state.settings
    settings.auth_mode = "oidc"
    settings.oidc_issuer = "https://identity.example.test/realms/workspace"
    settings.api_keys_enabled = True
    settings.oidc_lifecycle_sync_confirmed = True
    settings.oidc_lifecycle_client_id = "lifecycle-reader"
    settings.oidc_lifecycle_client_secret = SecretStr("service-secret")
    settings.oidc_upstream_verifier_url = "https://verifier.example.test/v1/check"
    settings.oidc_upstream_verifier_secret = SecretStr("verifier-secret")
    settings.oidc_access_group_id = "group-access"
    settings.oidc_admin_group_id = "group-admin"
    settings.oidc_reviewer_group_id = "group-reviewer"
    state = {"enabled": True, "groups": ["group-access", "group-admin", "group-reviewer"]}

    def handle(request):
        if state.get("unavailable"):
            return httpx.Response(503, text="service-secret must not be exposed")
        if request.url.host == "verifier.example.test":
            if state.get("upstream_unavailable"):
                return httpx.Response(503)
            assert request.headers["Authorization"] == "Bearer verifier-secret"
            data = json.loads(request.content)
            payload = {
                **data,
                "source_available": state.get("source_available", True),
                "enabled": state.get("upstream_enabled", True),
                "keycloak_access": state.get(
                    "upstream_keycloak_access", "group-access" in state["groups"]
                ),
                "groups": state.get("upstream_groups", state["groups"]),
                "checked_at": time.time() + state.get("clock_offset", 0),
            }
            if state.get("bad_nonce"):
                payload["nonce"] = "different-request"
            if state.get("bad_access_group"):
                payload["access_group_id"] = "different-group"
            if state.get("missing_upstream_enabled"):
                del payload["enabled"]
            if state.get("missing_keycloak_access"):
                del payload["keycloak_access"]
            return httpx.Response(200, json=payload)
        if request.url.path == "/realms/workspace/protocol/openid-connect/token":
            assert request.method == "POST"
            return httpx.Response(
                200, json={"access_token": "mock-service-token", "token_type": "Bearer"}
            )
        assert request.headers["Authorization"] == "Bearer mock-service-token"
        if request.url.path in {
            "/admin/realms/workspace/users/subject-1",
            "/admin/realms/workspace/users/subject-2",
        }:
            if state.get("kc_404"):
                return httpx.Response(404, text="not found")
            subject = request.url.path.rsplit("/", 1)[-1]
            data = {"id": subject, "username": "user"}
            if not state.get("missing_enabled"):
                data["enabled"] = state["enabled"] and subject not in state.get("disabled_ids", [])
            return httpx.Response(200, json=data)
        assert request.url.path in {
            "/admin/realms/workspace/users/subject-1/groups",
            "/admin/realms/workspace/users/subject-2/groups",
        }
        first, maximum = int(request.url.params["first"]), int(request.url.params["max"])
        if first and state.get("shift_groups"):
            state["groups"].pop(0)
            state["shift_groups"] = False
        return httpx.Response(
            200,
            json=[
                {"id": x, "name": x, "path": "/" + x}
                for x in state["groups"][first : first + maximum]
            ],
        )

    real_client = httpx.Client
    monkeypatch.setattr(
        identity_lifecycle.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    with app.state.db.session.begin() as s:
        user = User(
            subject=settings.oidc_issuer + "|subject-1", name="user", role=role, reviewer=reviewer
        )
        s.add(user)
        s.flush()
        user_id = user.id
        s.add(
            Session(digest=digest("session-token"), user_id=user_id, expires_at=time.time() + 600)
        )
        _, token = issue_key(s, user_id, "existing")
    return state, user_id, token


def test_group_removal_reduces_current_privileges_and_cannot_raise_local_roles(
    app, client, monkeypatch
):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    cookie = {"Cookie": "aag_session=session-token"}
    assert client.get("/api/admin/users", headers=cookie).status_code == 200
    assert client.get("/api/metrics?scope=review", headers=cookie).status_code == 200
    state["groups"] = ["group-access"]
    assert client.get("/api/admin/users", headers=cookie).status_code == 403
    assert client.get("/api/metrics?scope=review", headers=cookie).status_code == 403
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 200
    state["groups"] = ["group-access", "group-admin", "group-reviewer"]
    with app.state.db.session.begin() as s:
        user = s.get(User, user_id)
        user.role, user.reviewer = "user", False
    assert client.get("/api/admin/users", headers=cookie).status_code == 403
    assert client.get("/api/metrics?scope=review", headers=cookie).status_code == 403
    assert (
        client.get("/api/admin/users", headers={"Authorization": "Bearer " + token}).status_code
        == 403
    )


def test_deactivation_revokes_keys_sessions_clients_and_grants(app, client, monkeypatch):
    from aag.models import DeviceClient, DeviceGrant

    state, user_id, token = setup_keycloak(app, monkeypatch)
    with app.state.db.session.begin() as s:
        device = DeviceClient(owner_id=user_id, name="device")
        s.add(device)
        s.flush()
        device_id = device.id
        s.add(
            DeviceGrant(
                digest=digest("device-code"),
                user_code="ABCDEFGH",
                client_id=device_id,
                user_id=user_id,
                status="approved",
                expires_at=time.time() + 600,
            )
        )
    state["enabled"] = False
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 401
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is not None
        assert s.get(Session, digest("session-token")) is None
        assert not s.get(DeviceClient, device_id).active
        assert s.get(DeviceGrant, digest("device-code")).status == "denied"
    state["enabled"] = True
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 401
    assert (
        client.get("/api/auth/me", headers={"Cookie": "aag_session=session-token"}).status_code
        == 401
    )


def test_access_group_removal_denies_and_revokes_existing_key(app, client, monkeypatch):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    state["groups"] = ["group-admin", "group-reviewer"]
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 401
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is not None


def test_keycloak_only_access_removal_permanently_revokes_when_independently_confirmed(
    app, client, monkeypatch
):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    state["groups"] = ["group-admin", "group-reviewer"]
    state["upstream_groups"] = ["group-access", "group-admin", "group-reviewer"]
    state["upstream_keycloak_access"] = False
    headers = {"Authorization": "Bearer " + token}
    assert client.get("/api/scans", headers=headers).status_code == 401
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is not None
    state["groups"].append("group-access")
    state["upstream_keycloak_access"] = True
    assert client.get("/api/scans", headers=headers).status_code == 401


def test_upstream_staff_group_removal_attenuates_privileges_with_stale_keycloak(
    app, client, monkeypatch
):
    state, _, _ = setup_keycloak(app, monkeypatch)
    cookie = {"Cookie": "aag_session=session-token"}
    state["upstream_groups"] = ["group-access", "group-reviewer"]
    assert client.get("/api/admin/users", headers=cookie).status_code == 403
    assert client.get("/api/metrics?scope=review", headers=cookie).status_code == 200
    state["upstream_groups"] = ["group-access"]
    assert client.get("/api/metrics?scope=review", headers=cookie).status_code == 403


def test_provider_failure_or_missing_enabled_fails_closed_without_revocation(
    app, client, monkeypatch, caplog
):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    headers = {"Authorization": "Bearer " + token}
    for failure in ("unavailable", "missing_enabled"):
        state[failure] = True
        response = client.get("/api/scans", headers=headers)
        assert response.status_code == 503
        assert "service-secret" not in response.text
        state[failure] = False
        with app.state.db.session() as s:
            assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is None
    assert client.get("/api/scans", headers=headers).status_code == 200
    assert "service-secret" not in caplog.text and "mock-service-token" not in caplog.text


def test_required_group_can_appear_on_later_keycloak_page(app, client, monkeypatch):
    state, _, token = setup_keycloak(app, monkeypatch)
    state["groups"] = [f"other-{i}" for i in range(105)] + ["group-access"]
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 200


def test_group_shift_during_pagination_denies_without_revoking_credentials(
    app, client, monkeypatch
):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    state["groups"] = [f"other-{i}" for i in range(100)] + ["group-access"]
    state["upstream_groups"] = state["groups"].copy()
    state["shift_groups"] = True
    headers = {"Authorization": "Bearer " + token}
    assert client.get("/api/scans", headers=headers).status_code == 503
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is None


def test_keycloak_alone_cannot_establish_upstream_broker_freshness(app, client, monkeypatch):
    _, _, token = setup_keycloak(app, monkeypatch)
    app.state.settings.oidc_upstream_verifier_url = ""
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 503


def test_malformed_verifier_url_fails_closed_for_interactive_session(app, client, monkeypatch):
    setup_keycloak(app, monkeypatch)
    app.state.settings.oidc_upstream_verifier_url = "https://[broken"
    assert (
        client.get("/api/auth/me", headers={"Cookie": "aag_session=session-token"}).status_code
        == 503
    )


def test_upstream_denial_revokes_key_even_if_keycloak_has_stale_membership(
    app, client, monkeypatch
):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    state["upstream_groups"] = []
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 401
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is not None


def test_upstream_disabled_account_revokes_even_if_keycloak_is_stale(app, client, monkeypatch):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    state["upstream_enabled"] = False
    assert client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code == 401
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is not None


def test_keycloak_404_without_upstream_denial_is_an_outage_not_a_revocation(
    app, client, monkeypatch
):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    state["kc_404"] = True
    headers = {"Authorization": "Bearer " + token}
    assert client.get("/api/scans", headers=headers).status_code == 503
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is None
    state["upstream_enabled"] = False
    assert client.get("/api/scans", headers=headers).status_code == 401
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is not None


def test_mcp_transport_fails_closed_when_authoritative_source_is_offline(app, client, monkeypatch):
    state, _, token = setup_keycloak(app, monkeypatch)
    state["upstream_unavailable"] = True
    response = client.post(
        "/mcp/",
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json, text/event-stream",
        },
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
    )
    assert response.status_code == 503


def test_upstream_unavailable_or_stale_denies_without_revocation(app, client, monkeypatch, caplog):
    state, user_id, token = setup_keycloak(app, monkeypatch)
    headers = {"Authorization": "Bearer " + token}
    for key, value in (
        ("upstream_unavailable", True),
        ("source_available", False),
        ("clock_offset", -31),
        ("bad_nonce", True),
        ("bad_access_group", True),
        ("missing_upstream_enabled", True),
        ("missing_keycloak_access", True),
        ("upstream_groups", "not-a-list"),
    ):
        state[key] = value
        assert client.get("/api/scans", headers=headers).status_code == 503
        del state[key]
        with app.state.db.session() as s:
            assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is None
    assert client.get("/api/scans", headers=headers).status_code == 200
    assert "verifier-secret" not in caplog.text


def test_approved_device_grant_cannot_exchange_after_identity_deactivation(
    app, client, monkeypatch
):
    from aag.models import DeviceClient, DeviceGrant

    state, user_id, _ = setup_keycloak(app, monkeypatch)
    with app.state.db.session.begin() as s:
        device = DeviceClient(owner_id=user_id, name="device")
        s.add(device)
        s.flush()
        device_id = device.id
        s.add(
            DeviceGrant(
                digest=digest("device-code"),
                user_code="ABCDEFGH",
                client_id=device_id,
                user_id=user_id,
                status="approved",
                expires_at=time.time() + 600,
            )
        )
    state["enabled"] = False
    result = client.post(
        "/api/device/token", json={"client_id": device_id, "device_code": "device-code"}
    )
    assert result.status_code in (400, 401)
    assert "access_token" not in result.json()
    with app.state.db.session() as s:
        assert s.get(DeviceGrant, digest("device-code")).status == "denied"
        assert s.query(APIKey).filter_by(owner_id=user_id).count() == 1


def test_device_approver_is_checked_when_client_owner_is_a_different_user(app, client, monkeypatch):
    from aag.models import DeviceClient, DeviceGrant

    state, owner_id, _ = setup_keycloak(app, monkeypatch)
    with app.state.db.session.begin() as s:
        approver = User(subject=app.state.settings.oidc_issuer + "|subject-2", name="approver")
        s.add(approver)
        s.flush()
        approver_id = approver.id
        device = DeviceClient(owner_id=owner_id, name="device")
        s.add(device)
        s.flush()
        device_id = device.id
        s.add(
            DeviceGrant(
                digest=digest("device-code"),
                user_code="ABCDEFGH",
                client_id=device_id,
                user_id=approver_id,
                status="approved",
                expires_at=time.time() + 600,
            )
        )
    state["disabled_ids"] = ["subject-2"]
    result = client.post(
        "/api/device/token", json={"client_id": device_id, "device_code": "device-code"}
    )
    assert result.status_code == 401
    with app.state.db.session() as s:
        assert s.get(DeviceGrant, digest("device-code")).status == "denied"
        assert s.query(APIKey).filter_by(owner_id=approver_id).count() == 0


def test_device_provider_outage_does_not_consume_approved_grant(app, client, monkeypatch):
    from aag.models import DeviceClient, DeviceGrant

    state, user_id, _ = setup_keycloak(app, monkeypatch)
    with app.state.db.session.begin() as s:
        device = DeviceClient(owner_id=user_id, name="device")
        s.add(device)
        s.flush()
        device_id = device.id
        s.add(
            DeviceGrant(
                digest=digest("device-code"),
                user_code="ABCDEFGH",
                client_id=device_id,
                user_id=user_id,
                status="approved",
                expires_at=time.time() + 600,
            )
        )
    state["unavailable"] = True
    body = {"client_id": device_id, "device_code": "device-code"}
    assert client.post("/api/device/token", json=body).status_code == 503
    with app.state.db.session() as s:
        assert s.get(DeviceGrant, digest("device-code")).status == "approved"
    state["unavailable"] = False
    assert client.post("/api/device/token", json=body).json()["access_token"].startswith("aag_sk_")


def test_deactivation_during_key_creation_cannot_leave_a_future_usable_key(
    app, client, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from aag import routes_identity

    state, user_id, token = setup_keycloak(app, monkeypatch)
    started, resume = Event(), Event()
    require = routes_identity.require_api_keys

    def pause_before_create(settings):
        require(settings)
        started.set()
        assert resume.wait(10)

    monkeypatch.setattr(routes_identity, "require_api_keys", pause_before_create)
    cookie = {"Cookie": "aag_session=session-token"}
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(client.post, "/api/api-keys", json={"name": "race"}, headers=cookie)
        assert started.wait(10)
        state["enabled"] = False
        assert (
            client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code
            == 401
        )
        resume.set()
        response = future.result(timeout=10)
    assert response.status_code == 401
    with app.state.db.session() as s:
        keys = s.query(APIKey).filter_by(owner_id=user_id).all()
        assert len(keys) == 1 and keys[0].revoked_at is not None


def test_approved_grant_expiring_during_provider_check_cannot_issue_key(app, client, monkeypatch):
    from aag import routes_identity
    from aag.models import DeviceClient, DeviceGrant

    _, user_id, _ = setup_keycloak(app, monkeypatch)
    with app.state.db.session.begin() as s:
        device = DeviceClient(owner_id=user_id, name="device")
        s.add(device)
        s.flush()
        device_id = device.id
        s.add(
            DeviceGrant(
                digest=digest("device-code"),
                user_code="ABCDEFGH",
                client_id=device_id,
                user_id=user_id,
                status="approved",
                expires_at=time.time() + 10,
            )
        )
    real_check = routes_identity.ensure_user_current
    real_time = time.time
    clock = {"advance": 0}
    monkeypatch.setattr(routes_identity.time, "time", lambda: real_time() + clock["advance"])

    def expire_during_check(*args):
        result = real_check(*args)
        clock["advance"] = 20
        return result

    monkeypatch.setattr(routes_identity, "ensure_user_current", expire_during_check)
    result = client.post(
        "/api/device/token", json={"client_id": device_id, "device_code": "device-code"}
    )
    assert result.status_code == 400
    assert result.json()["error"] == "expired_token"
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).count() == 1


def test_public_auth_config_reports_key_availability_without_secrets(app, client):
    settings = app.state.settings
    assert client.get("/api/auth/config").json()["api_keys_state"] == "available"
    settings.api_keys_enabled = False
    assert client.get("/api/auth/config").json()["api_keys_state"] == "disabled"
    settings.api_keys_enabled = True
    settings.auth_mode = "oidc"
    settings.oidc_issuer = "https://identity.example.test/realms/workspace"
    settings.oidc_lifecycle_sync_confirmed = True
    response = client.get("/api/auth/config")
    assert response.json()["api_keys_state"] == "identity_unconfigured"
    assert "client_secret" not in response.text


def test_missing_custom_ca_fails_closed_without_revocation(app, client, monkeypatch, tmp_path):
    _, user_id, token = setup_keycloak(app, monkeypatch)
    app.state.settings.oidc_lifecycle_ca_bundle = str(tmp_path / "missing-ca.pem")
    response = client.get("/api/scans", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 503
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=user_id).one().revoked_at is None


def test_cleanup_remains_available_when_key_issuance_disabled(app, client):
    key = client.post("/api/api-keys", json={"name": "old"}).json()
    device = client.post("/api/device-clients", json={"name": "old"}).json()
    app.state.settings.api_keys_enabled = False
    assert (
        client.post(
            "/api/api-keys/" + key["id"] + "/revoke", json={"reason": "No longer used"}
        ).status_code
        == 200
    )
    assert client.delete("/api/device-clients/" + device["id"]).status_code == 200


def test_deactivation_during_oidc_callback_cannot_issue_surviving_session(app, client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from types import SimpleNamespace
    from urllib.parse import parse_qs, urlparse

    import httpx
    from aag import routes_identity
    from aag.models import OIDCState

    state, user_id, token = setup_keycloak(app, monkeypatch)
    settings = app.state.settings
    metadata = {
        "authorization_endpoint": settings.oidc_issuer + "/authorize",
        "token_endpoint": settings.oidc_issuer + "/token",
        "jwks_uri": settings.oidc_issuer + "/jwks",
    }

    async def discovery(_):
        return metadata

    class TokenClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, *args, **kwargs):
            return httpx.Response(200, json={"id_token": "mock-token"})

    monkeypatch.setattr(routes_identity, "discovery", discovery)
    monkeypatch.setattr(routes_identity.httpx, "AsyncClient", TokenClient)
    monkeypatch.setattr(
        routes_identity.jwt,
        "PyJWKClient",
        lambda _: SimpleNamespace(
            get_signing_key_from_jwt=lambda _: SimpleNamespace(key="mock-key")
        ),
    )
    flow = client.get("/api/auth/oidc/login", follow_redirects=False)
    flow_state = parse_qs(urlparse(flow.headers["location"]).query)["state"][0]
    with app.state.db.session() as s:
        nonce = s.get(OIDCState, digest(flow_state)).nonce
    monkeypatch.setattr(
        routes_identity.jwt,
        "decode",
        lambda *args, **kwargs: {"sub": "subject-1", "nonce": nonce, "preferred_username": "user"},
    )
    checked, resume = Event(), Event()
    real_check = routes_identity.check_identity

    def pause_after_check(*args):
        result = real_check(*args)
        checked.set()
        assert resume.wait(10)
        return result

    monkeypatch.setattr(routes_identity, "check_identity", pause_after_check)
    callback = "/sso/callback?code=test-code&state=" + flow_state
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(client.get, callback, follow_redirects=False)
        assert checked.wait(10)
        state["enabled"] = False
        assert (
            client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code
            == 401
        )
        resume.set()
        result = future.result(timeout=10)
    assert result.status_code == 401
    with app.state.db.session() as s:
        assert s.query(Session).filter_by(user_id=user_id).count() == 0


def test_deactivation_during_device_exchange_cannot_mint_key(app, client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from aag import routes_identity
    from aag.models import DeviceClient, DeviceGrant

    state, owner_id, _ = setup_keycloak(app, monkeypatch)
    with app.state.db.session.begin() as s:
        approver = User(subject=app.state.settings.oidc_issuer + "|subject-2", name="approver")
        s.add(approver)
        s.flush()
        approver_id = approver.id
        _, token = issue_key(s, approver_id, "existing")
        device = DeviceClient(owner_id=owner_id, name="device")
        s.add(device)
        s.flush()
        device_id = device.id
        s.add(
            DeviceGrant(
                digest=digest("device-code"),
                user_code="ABCDEFGH",
                client_id=device_id,
                user_id=approver_id,
                status="approved",
                expires_at=time.time() + 600,
            )
        )
    checked, resume = Event(), Event()
    original_check = routes_identity.ensure_user_current

    def pause_after_approver(*args):
        result = original_check(*args)
        if args[2] == approver_id:
            checked.set()
            assert resume.wait(10)
        return result

    monkeypatch.setattr(routes_identity, "ensure_user_current", pause_after_approver)
    body = {"client_id": device_id, "device_code": "device-code"}
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(client.post, "/api/device/token", json=body)
        assert checked.wait(10)
        state["disabled_ids"] = ["subject-2"]
        assert (
            client.get("/api/scans", headers={"Authorization": "Bearer " + token}).status_code
            == 401
        )
        resume.set()
        result = future.result(timeout=10)
    assert result.status_code == 401
    with app.state.db.session() as s:
        assert s.query(APIKey).filter_by(owner_id=approver_id).count() == 1
        assert s.get(DeviceGrant, digest("device-code")).status == "denied"
