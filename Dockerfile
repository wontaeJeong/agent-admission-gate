FROM node:24-bookworm-slim AS web
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
COPY backend/ ./backend/
RUN uv sync --frozen --no-dev
COPY alembic.ini ./
COPY --from=web /build/dist ./frontend/dist
RUN useradd --uid 10001 --create-home aag && mkdir /app/data && chown aag:aag /app/data
USER 10001
ENV PATH="/app/.venv/bin:$PATH" AAG_FRONTEND_DIR=/app/frontend/dist
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=2)"
# Single process by design. Run migrations as a deployment step, never in every replica.
CMD ["uvicorn", "aag.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]

FROM anchore/syft:v1.54.1 AS syft
FROM anchore/grype:v0.120.1 AS grype
FROM anchore/grant:v0.6.8 AS grant
FROM runtime AS scanners
USER root
COPY --from=syft /syft /usr/local/bin/syft
COPY --from=grype /grype /usr/local/bin/grype
COPY --from=grant /grant /usr/local/bin/grant
ENV UV_TOOL_DIR=/opt/scanner-tools UV_TOOL_BIN_DIR=/usr/local/bin
RUN uv tool install --python /usr/local/bin/python cisco-ai-mcp-scanner==4.8.2 && \
    uv tool install --python /usr/local/bin/python cisco-ai-skill-scanner==2.3.2
USER 10001
