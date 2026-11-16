import base64
import hashlib
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa


@pytest.mark.parametrize(
    "target, expected",
    [
        (
            "/jobs/job-1?tab=findings&finding=abc&occurrence=2",
            "/jobs/job-1?tab=findings&finding=abc&occurrence=2",
        ),
        ("//evil.test", "/"),
        (None, "/"),
    ],
)
def test_oidc_returns_only_to_saved_state_target(app, client, monkeypatch, target, expected):
    from aag import routes_identity
    from aag.auth import digest
    from aag.models import OIDCState

    settings = app.state.settings
    settings.auth_mode = "oidc"
    settings.oidc_issuer = "https://identity.example.test"
    settings.oidc_client_id = "admission-test"
    settings.oidc_admin_subjects = []
    settings.oidc_access_group_id = "access"
    settings.oidc_lifecycle_sync_confirmed = False
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    flow = {}

    def respond(request):
        if request.url.path == "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    "issuer": settings.oidc_issuer,
                    "authorization_endpoint": settings.oidc_issuer + "/authorize",
                    "token_endpoint": settings.oidc_issuer + "/token",
                    "jwks_uri": settings.oidc_issuer + "/jwks",
                },
            )
        assert request.url.path == "/token"
        body = parse_qs(request.content.decode())
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(body["code_verifier"][0].encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        assert challenge == flow["code_challenge"][0]
        claims = {
            "iss": settings.oidc_issuer,
            "sub": "regular-user",
            "aud": settings.oidc_client_id,
            "iat": int(time.time()),
            "exp": int(time.time()) + 300,
            "nonce": flow["nonce"][0],
            "preferred_username": "oidc-user",
        }
        token = jwt.encode(claims, private, algorithm="RS256")
        return httpx.Response(200, json={"id_token": token})

    real = httpx.AsyncClient
    monkeypatch.setattr(
        routes_identity.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(respond), trust_env=False, **kw),
    )
    monkeypatch.setattr(
        routes_identity.jwt,
        "PyJWKClient",
        lambda uri: SimpleNamespace(
            get_signing_key_from_jwt=lambda token: SimpleNamespace(key=private.public_key())
        ),
    )
    login = client.get(
        "/api/auth/oidc/login",
        params={"return_to": target} if target else {},
        follow_redirects=False,
    )
    assert login.status_code == 307
    flow.update(parse_qs(urlparse(login.headers["location"]).query))
    assert flow["code_challenge_method"] == ["S256"]
    if target is None:
        with app.state.db.session.begin() as s:
            s.get(OIDCState, digest(flow["state"][0])).return_to = None
    callback = "/sso/callback?code=test-code&state=" + flow["state"][0]
    response = client.get(callback + "&return_to=//evil.test", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == expected
    user = client.get("/api/auth/me").json()
    assert user["name"] == "oidc-user" and user["role"] == "user" and not user["reviewer"]
    assert client.get(callback, follow_redirects=False).status_code == 400
