import base64
import hashlib
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa


@pytest.mark.parametrize("invalid", [None, "nonce", "issuer", "audience", "expired", "signature"])
def test_oidc_pkce_signature_claims_and_single_use(app, client, monkeypatch, invalid):
    from aag import routes_identity

    settings = app.state.settings
    settings.auth_mode = "oidc"
    settings.oidc_issuer = "https://identity.example.test"
    settings.oidc_client_id = "admission-test"
    settings.oidc_admin_subjects = []
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    wrong = rsa.generate_private_key(public_exponent=65537, key_size=2048)
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
        if invalid == "nonce":
            claims["nonce"] = "wrong-nonce"
        if invalid == "issuer":
            claims["iss"] = "https://untrusted.example.test"
        if invalid == "audience":
            claims["aud"] = "another-client"
        if invalid == "expired":
            claims["exp"] = int(time.time()) - 60
        token = jwt.encode(claims, wrong if invalid == "signature" else private, algorithm="RS256")
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
    login = client.get("/api/auth/oidc/login", follow_redirects=False)
    assert login.status_code == 307
    flow.update(parse_qs(urlparse(login.headers["location"]).query))
    assert flow["code_challenge_method"] == ["S256"]
    callback = "/sso/callback?code=test-code&state=" + flow["state"][0]
    response = client.get(callback, follow_redirects=False)
    assert response.status_code == (401 if invalid else 303)
    if not invalid:
        user = client.get("/api/auth/me").json()
        assert user["name"] == "oidc-user" and user["role"] == "user" and not user["reviewer"]
    assert client.get(callback, follow_redirects=False).status_code == 400
