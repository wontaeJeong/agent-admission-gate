import secrets
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select

from .auth import RateLimiter, authenticate, password_hash
from .config import get_settings
from .db import Database
from .mcp_server import build_mcp
from .models import Usage, User
from .routes_admin import router as admin_router
from .routes_boards import router as boards_router
from .routes_identity import oidc_callback
from .routes_identity import router as identity_router
from .routes_metrics import router as metrics_router
from .routes_scans import router as scans_router
from .service import ScanService


def create_app(settings=None):
    settings = settings or get_settings()
    db = Database(settings.database_url)
    scans = ScanService(db, settings)
    mcp_app = build_mcp(db, settings, scans)

    @asynccontextmanager
    async def lifespan(app):
        if settings.environment in {"development", "test"}:
            db.create()
        # Production schema is applied explicitly with Alembic before startup.
        with db.session.begin() as s:
            password = settings.bootstrap_password.get_secret_value()
            if settings.auth_mode == "local" and password:
                if len(password) < 12:
                    raise ValueError("Bootstrap password must contain at least 12 characters")
                if not s.scalar(
                    select(User).where(User.subject == "local:" + settings.bootstrap_admin)
                ):
                    s.add(
                        User(
                            subject="local:" + settings.bootstrap_admin,
                            name=settings.bootstrap_admin,
                            role="admin",
                            reviewer=True,
                            password_hash=password_hash(password),
                        )
                    )
        scans.recover()
        async with mcp_app.lifespan(app):
            yield
        await scans.shutdown()
        db.engine.dispose()

    app = FastAPI(
        title="Agent Admission Gate",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings, app.state.db, app.state.scans = settings, db, scans
    app.state.limiter = RateLimiter()
    app.state.admin_lock = threading.Lock()
    app.state.dummy_password_hash = password_hash(secrets.token_urlsafe(32))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]}
                    for e in exc.errors()
                ]
            },
        )

    @app.middleware("http")
    async def security_and_usage(request: Request, call_next):
        start = time.monotonic()
        # Enforce limits before multipart parsing; chunked bodies are bounded below.
        size = request.headers.get("content-length")
        if size and (not size.isdigit() or int(size) > settings.max_upload_bytes + 1_000_000):
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        if request.method in {"POST", "PUT", "PATCH"}:
            received = 0
            original_receive = request._receive

            async def bounded_receive():
                nonlocal received
                message = await original_receive()
                received += len(message.get("body", b""))
                if received > settings.max_upload_bytes + 1_000_000:
                    raise HTTPException(413, "Request too large")
                return message

            request._receive = bounded_receive
        if request.url.path.startswith("/mcp"):
            try:
                authenticate(db, settings, request.headers.get("authorization"))
            except HTTPException as exc:
                return JSONResponse(
                    {"detail": exc.detail},
                    status_code=exc.status_code,
                    headers={"WWW-Authenticate": "Bearer"},
                )
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.path.startswith("/api") or request.url.path == "/sso/callback":
            response.headers["Cache-Control"] = "no-store"
        if request.url.path != "/api/docs":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
            )
        if settings.cookie_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        if request.url.path.startswith("/api/"):
            a = getattr(request.state, "actor", None)
            route = request.scope.get("route")
            with db.session.begin() as s:
                s.add(
                    Usage(
                        user_id=a.id if a else None,
                        key_id=a.key_id if a else None,
                        kind="api",
                        route=getattr(route, "path", "/api/unknown"),
                        status=response.status_code,
                        latency_ms=(time.monotonic() - start) * 1000,
                    )
                )
        return response

    for router in (identity_router, scans_router, admin_router, metrics_router, boards_router):
        app.include_router(router)

    @app.get("/health/live")
    def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready():
        with db.session() as s:
            s.execute(select(1))
        return {"status": "ok"}

    @app.get("/sso/callback")
    async def callback(request: Request, code: str, state: str):
        return await oidc_callback(request, code, state)

    app.mount("/mcp", mcp_app)

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith(("api/", "health/", "mcp/")):
            raise HTTPException(404, "Not found")
        root = settings.frontend_dir.resolve()
        file = (root / path).resolve()
        if file.is_relative_to(root) and file.is_file():
            return FileResponse(file)
        if (root / "index.html").exists():
            return FileResponse(root / "index.html")
        raise HTTPException(404, "Build frontend with npm run build")

    return app


app = create_app()
