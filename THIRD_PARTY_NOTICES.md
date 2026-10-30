# Third-party software and assets

The lockfiles are the authoritative dependency versions. Upstream licenses still apply; the project does not grant rights over upstream trademarks.

| Component | Upstream license / source |
| --- | --- |
| React, Vite, Recharts, React Router, Tailwind CSS | MIT; respective package LICENSE files |
| Lucide icons | ISC; lucide.dev/license |
| FastAPI, SQLAlchemy, Alembic, Pydantic, Typer, FastMCP | MIT; respective upstream repositories |
| Uvicorn | BSD-3-Clause |
| Psycopg 3 | LGPL-3.0; psycopg.org/license |
| Boto3 | Apache-2.0 |
| Pretendard Variable 1.3.9 | SIL Open Font License 1.1; github.com/orioncactus/pretendard |
| D2Coding | SIL Open Font License 1.1; github.com/naver/d2-coding-font |
| Cisco AI MCP Scanner / Skill Scanner | Apache-2.0; github.com/cisco-ai-defense |
| Syft, Grype, Grant | Apache-2.0; github.com/anchore |
| OSV-Scanner | Apache-2.0; github.com/google/osv-scanner |
| Astro / Starlight | MIT |

Existing Gate/Shield/Check brand assets were supplied by the repository owner from the prior brand kit. This project is independent of Cisco, Anchore and other upstream vendors. Optional hosted AI services have their own service and pricing terms; local model weights have their own licenses.

Scanner license findings are evidence for organizational review, not legal advice. Unknown and compound license expressions require review. The default Grant allowlist is deliberately small and can be revised as versioned policy code.

Pretendard is bundled from the pinned npm package; D2Coding WOFF2 is distributed from https://github.com/wan2land/d2coding (font copyright NAVER). Both are self-hosted, with full OFL notices in `frontend/public/fonts/`.
