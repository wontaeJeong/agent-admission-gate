"""Browser-test app: replace only external OIDC HTTP/JWKS boundaries.

No test routes are added to the production application. The normal state, PKCE,
JWT signature/claims, cookie, ownership and frontend handlers remain in use.
"""

import base64
import hashlib
import os
import ssl
import threading
import time
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt
from aag import routes_identity
from aag.config import Settings
from aag.main import create_app
from aag.models import Job, User
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


class AuthorizationProvider(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlsplit(self.path).query)
        assert urlsplit(self.path).path == "/authorize"
        assert query["code_challenge_method"] == ["S256"]
        cookies = SimpleCookie(self.headers.get("Cookie", ""))
        account = cookies["oidc_test_account"].value if "oidc_test_account" in cookies else "alice"
        code = urlencode(
            {
                "account": account,
                "nonce": query["nonce"][0],
                "challenge": query["code_challenge"][0],
            }
        )
        callback = (
            query["redirect_uri"][0] + "?" + urlencode({"state": query["state"][0], "code": code})
        )
        self.send_response(302)
        self.send_header("Location", callback)
        self.end_headers()

    def log_message(self, *_args):
        pass  # Authorization codes, state and cookies must never enter fixture logs.


certificate_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
certificate = (
    x509.CertificateBuilder()
    .subject_name(name)
    .issuer_name(name)
    .public_key(certificate_key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.now(UTC) - timedelta(minutes=1))
    .not_valid_after(datetime.now(UTC) + timedelta(hours=1))
    .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
    .sign(certificate_key, hashes.SHA256())
)
fixture_dir = Path(os.environ["AAG_OIDC_FIXTURE_DIR"])
cert_path, key_path = fixture_dir / "provider.pem", fixture_dir / "provider.key"
cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
key_path.write_bytes(
    certificate_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
)
https_provider = ThreadingHTTPServer(("127.0.0.1", 0), AuthorizationProvider)
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain(cert_path, key_path)
https_provider.socket = tls.wrap_socket(https_provider.socket, server_side=True)
threading.Thread(target=https_provider.serve_forever, daemon=True).start()
ISSUER = "https://localhost:" + str(https_provider.server_port)
CLIENT = "aag-browser-test"
private = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def provider(request):
    assert request.url.host == "localhost" and request.url.port == https_provider.server_port
    if request.url.path == "/.well-known/openid-configuration":
        return httpx.Response(
            200,
            json={
                "issuer": ISSUER,
                "authorization_endpoint": ISSUER + "/authorize",
                "token_endpoint": ISSUER + "/token",
                "jwks_uri": ISSUER + "/jwks",
            },
        )
    assert request.url.path == "/token"
    body = parse_qs(request.content.decode())
    code = parse_qs(body["code"][0])
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(body["code_verifier"][0].encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    assert code["challenge"] == [challenge]
    assert code["account"][0] in {"alice", "bob"}
    claims = {
        "iss": ISSUER,
        "aud": CLIENT,
        "sub": code["account"][0],
        "nonce": code["nonce"][0],
        "iat": int(time.time()),
        "exp": int(time.time()) + 300,
        "preferred_username": code["account"][0],
    }
    return httpx.Response(200, json={"id_token": jwt.encode(claims, private, algorithm="RS256")})


real_client = httpx.AsyncClient
routes_identity.httpx.AsyncClient = lambda **kw: real_client(
    transport=httpx.MockTransport(provider), trust_env=False, **kw
)
routes_identity.jwt.PyJWKClient = lambda uri: SimpleNamespace(
    get_signing_key_from_jwt=lambda token: SimpleNamespace(key=private.public_key())
)

app = create_app(
    Settings(
        review_workflow_enabled=os.environ.get("AAG_C1_FIXTURE") == "true",
        environment="test",
        auth_mode="oidc",
        oidc_issuer=ISSUER,
        oidc_client_id=CLIENT,
        public_url=os.environ["AAG_PUBLIC_URL"],
        database_url=os.environ["AAG_DATABASE_URL"],
        cookie_secure=False,
        oidc_lifecycle_sync_confirmed=False,
    )
)
app.state.db.create()
with app.state.db.session.begin() as s:
    for account in ("alice", "bob"):
        s.add(User(id="a1-" + account, subject=ISSUER + "|" + account, name=account, role="admin" if os.environ.get("AAG_C1_FIXTURE") == "true" and account == "alice" else "user", reviewer=os.environ.get("AAG_C1_FIXTURE") == "true"))
    s.flush()
    s.add(
        Job(
            id="a1-synthetic-job",
            owner_id="a1-alice",
            source="synthetic-package.zip",
            source_type="zip",
            profile="static",
            status="COMPLETED",
            verdict="BLOCK",
            effective_verdict="BLOCK",
            content_hash="a" * 64,
            completed_at=time.time(),
            result={
                "coverage_complete": False,
                "engines": [],
                "limitations": ["Synthetic browser-test result."],
                "findings": [
                    {
                        "fingerprint": "synthetic-finding",
                        "engine": "builtin",
                        "rule": "EXAMPLE-1",
                        "severity": "high",
                        "title": "Synthetic finding for login return",
                        "path": "example.txt",
                        "line": 1,
                        "action": "security",
                        "evidence": "Synthetic evidence.",
                        "remediation": "Review the example.",
                        "suppressed": False,
                    }
                ],
            },
        )
    )

if app.state.settings.search_enabled:
    from aag.search_index import index_job_findings
    from aag.models import Review
    with app.state.db.session.begin() as s:
        job = s.get(Job, "a1-synthetic-job")
        first = {**job.result["findings"][0], "rule": "CVE-2026-1234", "title": "CVE-2026-1234 first"}
        second = {**first, "title": "CVE-2026-1234 second"}
        job.result = {**job.result, "findings": [first, second]}
        index_job_findings(s, job)
        s.get(User, "a1-bob").reviewer = False
        s.add(Review(id="search-review", job_id=job.id, requester_id=job.owner_id, reason="Synthetic review request"))
        s.add(Job(id="search-unindexed", owner_id="a1-bob", source="pending-index.zip",
                  source_type="upload", profile="static", status="COMPLETED", result={"findings": []}))

if os.environ.get("AAG_NOTIFICATION_TARGETS_FIXTURE") == "true":
    from aag.models import APIKey, ExceptionRule
    from aag.notifications import emit_notification, emit_resource_notification
    with app.state.db.session.begin() as s:
        s.get(User, "a1-alice").role = "admin"
        s.add(APIKey(id="d1-key", owner_id="a1-alice", name="Build integration", digest="fixture-only-key", suffix="test", expires_at=time.time() + 3600))
        s.add(APIKey(id="d1-revoked", owner_id="a1-alice", name="Retired integration", digest="fixture-only-revoked", suffix="test", expires_at=time.time() + 3600, revoked_at=time.time()))
        s.add(ExceptionRule(id="d1-exception", created_by="a1-alice", source="synthetic-policy.zip", reason="Synthetic exact-content exception", fingerprint="c"*64, content_hash="a"*64, expires_at=time.time()-60))
        s.flush()
        emit_notification(s, "scan.completed", s.get(Job, "a1-synthetic-job"), ["a1-alice"], "d1-scan")
        emit_resource_notification(s, "key.expiring_1d", "api_key", "d1-key", ["a1-alice"], "d1-key")
        emit_resource_notification(s, "key.expiring_7d", "api_key", "d1-revoked", ["a1-alice"], "d1-revoked")
        emit_resource_notification(s, "exception.expired", "exception", "d1-exception", ["a1-alice"], "d1-exception")


expiration_mode = os.environ.get("AAG_EXPIRATION_REMINDERS_FIXTURE")
if expiration_mode:
    from aag.models import APIKey, ExceptionRule
    from aag import expiration_reminders

    now = expiration_reminders.database_now(app.state.db)
    app.state.settings.expiry_reminders_enabled = expiration_mode != "disabled"
    app.state.settings.expiry_reminders_enabled_at = None if expiration_mode == "unconfigured" else now - 14400
    if expiration_mode == "waiting":
        app.state.settings.expiry_reminders_enabled_at = now
    with app.state.db.session.begin() as s:
        s.get(User, "a1-alice").role = "admin"
        s.add(APIKey(id="d2-key", owner_id="a1-alice", name="Build integration", digest="d2-synthetic",
                     suffix="test", expires_at=now+3600))
        s.add(ExceptionRule(id="d2-exception", created_by="a1-alice", source="synthetic-policy.zip",
                            reason="Synthetic private exception reason", fingerprint="c"*64,
                            content_hash="a"*64, expires_at=now-60))
    if expiration_mode not in {"waiting", "unconfigured"}:
        producer = expiration_reminders.emit_resource_notification
        def synthetic_failure(s, kind, resource_type, resource_id, *args, **kwargs):
            if resource_type == "api_key":
                raise RuntimeError("Synthetic failure, private details must stay out of status")
            return producer(s, kind, resource_type, resource_id, *args, **kwargs)
        if expiration_mode == "failed":
            expiration_reminders.emit_resource_notification = synthetic_failure
            # A recent successful empty run keeps failure distinct from delay.
            expiration_reminders.emit_due_expirations(app.state.db, now=now-120, dry_run=False,
                                                     batch_size=1, max_batches=1)
            app.state.settings.expiry_reminders_enabled_at = now-60
        expiration_reminders.emit_due_expirations(app.state.db, now=now-10800 if expiration_mode == "delayed" else now)
        expiration_reminders.emit_resource_notification = producer
