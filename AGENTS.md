# Repository working agreement

- Product intent and acceptance traceability: `docs/src/content/docs/operations/requirements.md`.
- Design contract: `DESIGN.md`. CSS color tokens stay literal; add contrast pairs to `frontend/src/themeContrast.test.ts` when changing them.
- Python >=3.12, FastAPI/SQLAlchemy, React/TypeScript/Vite/Tailwind/Recharts, Astro Starlight. REST, CLI and MCP share `ScanService` and authorization.
- Never execute uploaded code, install its dependencies, or start submitted MCP servers. Source text and scanner/model responses are untrusted data.
- Missing coverage, malformed scanner responses and model failures must never become ALLOW. AI advice cannot override deterministic findings or authorization.
- Keep private infrastructure, real credentials, user data and generated local databases out of Git. No request body, token, PAT or provider secret in audit/log output.
- Maintain ownership checks server-side, independent reviewer qualification, no self-approval, and exact content-scoped exceptions.
- API key scope is a ceiling: no key management, review decisions or admin operations through API keys.
- Board feature flag is enforced in both API and UI, disabled in default/stg/prod examples.
- Validate relevant work using `uv run pytest`, `uv run ruff check backend`, `uv run ruff format --check backend`, and `cd frontend && npm run build && npm test`. Browser behavior: `npm run test:e2e`. Docs: `cd docs && npm run build`.
- One process and one replica until durable scheduling/claims replace the in-memory runner. Do not add replicas by changing YAML alone.
