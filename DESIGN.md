# Graphite & Plum / operational UI

Compact operational workspace inspired by source-control and incident tooling. Evidence, job state and next action lead; minimal shadows, 8px controls, 10px panels, 20–24px panel padding, 38px controls. Never substitute sample metrics for real API data.

## Tokens

| Token | Dark | Light |
| --- | --- | --- |
| canvas | #0d1018 | #f8f9fc |
| raised | #171b26 | #ffffff |
| surface | #1e2432 | #f1f3f8 |
| surface-soft | #272d40 | #e9ecf4 |
| line | #2c3445 | #e0e4ee |
| ink | #edf0f8 | #222636 |
| ink-muted | #a5aec0 | #596378 |
| accent / link | #d4a1eb | #78469e |
| accent-strong | #eac7f6 | #623680 |
| accent-subtle | #352a43 | #eee5f4 |

Light muted ink is darkened to pass body-text contrast. Literal CSS tokens are independently declared, not chained `var()` aliases. Semantic success/warning/danger colors remain independent from palette selection.

## Brand source of truth

The original 2026-10-22 Gate/Shield/Check SVG geometry is retained in `assets/brand/original`. `frontend/src/Brand.tsx` renders these same three paths inline; `--brand-primary`, `--brand-secondary`, `--brand-on` color the mark. No raster regeneration is needed to change colors.

Palette and mode are separate attributes: `data-theme=dark|light`, `data-palette=plum|teal|blue`. Brand and interface tokens change together. `syncFavicon()` exports the active tokens into an SVG data URI; static favicon uses `prefers-color-scheme` before JS starts. External SVG `<img>` cannot inherit page CSS. README uses fixed light/dark exports through `<picture>`; native touch icons remain fixed raster assets.

## Structure and interactions

Fixed sidebar: new scan at top; Inspect (dashboard/jobs/reviews for reviewer), Connect (guide/keys/device clients), optional boards, Admin for admin, user/logout/language/theme at bottom. Mobile menu collapses, tables scroll within panels. Main content receives focus on navigation; controls have keyboard focus outlines and labelled fields.

Dashboard: personal/review/all scope gated by role; 7/14/30/90 days; attention/distribution/recent tabs. Trends have zero-filled UTC buckets. Unknown tokens and cost show `—`; errors never count as successful admissions.

Scan detail: Admission/comments/findings/actions/engines/metadata/timeline/Raw JSON. Findings use list + selected evidence, severity filtering, exact location and remediation. Execution status and verdict are different concepts. Cancellation and revocation require an explicit UI action; irreversible revocation has a reason and confirmation form.

Code blocks remain dark in light mode. Pretendard Variable 1.3.9 is the UI font; D2Coding is for code. Both fonts are self-hosted with OFL notices and system fallbacks; runtime rendering does not require a font CDN. Markdown never enables raw HTML, external images or unsafe URL schemes.
