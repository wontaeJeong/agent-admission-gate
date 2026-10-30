.PHONY: install check test web run migrate
install:
	uv sync --frozen
	cd frontend && npm ci
check:
	uv run ruff check backend
	uv run ruff format --check backend
	cd frontend && npm run build
	cd frontend && npm test
test:
	uv run pytest
	cd frontend && npm run test:e2e
web:
	cd frontend && npm run build
run:
	uv run uvicorn aag.main:app --host 127.0.0.1 --port 8000 --no-access-log
migrate:
	uv run alembic upgrade head
