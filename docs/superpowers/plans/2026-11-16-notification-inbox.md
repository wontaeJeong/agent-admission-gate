# Notification Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a durable personal inbox connected to real scan/review events with a responsive notification UI.

**Architecture:** Persist per-recipient events in the same transaction as the business change; share notification visibility between counts, reads and mutations. Refresh through session-authenticated REST without a new broker or mail provider.

**Tech Stack:** Existing Python 3.12+/FastAPI/SQLAlchemy/Alembic, React/TypeScript/Radix/Vite, pytest and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-notification-inbox-design.md`

## Global Constraints

- Session-only REST; existing same-origin guard; current ownership and independent reviewer qualification.
- No notification copies of untrusted comment/error/decision bodies or secrets.
- No new runtime dependencies, email delivery, or replica changes.
- Default 90-day inbox retention, 25 rows per page, 30-second visible-tab refresh.
- Existing literal CSS tokens, bilingual copy, light/dark/mobile support.

## Review Focus

- Reviewer demotion must hide alerts and counts together, including direct mutation URLs.
- A retry or duplicate terminal transition must not duplicate alerts or undo cancellation.
- A late response after account change must not populate the new account's bell/inbox.
- Mark-all must respect filters and leave post-snapshot arrivals unread.
- Internal comments and raw failure/decision reasons must not appear in notification payloads.

### Task 1: Durable events and session API

**Files:** `backend/aag/models.py`, `notifications.py`, `routes_notifications.py`, `service.py`, `routes_scans.py`, `main.py`, `cli.py`; new migration and `backend/tests/test_notifications.py`.

**Interfaces:** `emit_notification(s, kind, job, recipients, event_key, review_id=None)` writes in the caller's transaction; shared `visible_notifications(a, now)` scopes resources and retention. REST list returns `{items,total,unread_count,snapshot_at}`; item fields `{id,kind,source,href,verdict,created_at,read_at,archived_at}`. Preferences use `{scans,review_requests,review_results,comments}` booleans.

- [ ] Write real API/workflow tests for scan completion/failure/recovery/cache, review audiences/results, duplicate writes/rollback, comment privacy, isolation/session/CSRF, filters/state/preferences and retention.
- [ ] Run `uv run pytest backend/tests/test_notifications.py -q`; confirm missing endpoints/notifications fail.
- [ ] Implement indexed models/migration, transactional emitter, lifecycle integrations, scoped REST and operator pruning.
- [ ] Run backend tests, lint/format and migration upgrade/check/downgrade/upgrade; commit backend deliverable.

### Task 2: Bell, inbox and settings

**Files:** `frontend/src/notifications.tsx`, `frontend/src/pages/Notifications.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/AccountSettings.tsx`, `frontend/src/styles.css`, `frontend/e2e/notifications.spec.ts`.

**Interfaces:** Task 1 REST contracts; account-keyed `NotificationProvider`, `useNotifications()` with count/revision/refresh, shared item labels and open/read helpers.

- [ ] Add browser scenarios for bell entry/open-to-read, filters, mark-all, individual unread/archive/restore, preferences, error retry and account-switch response races.
- [ ] Run new browser tests against the pre-implementation UI; confirm absent UI failures.
- [ ] Implement account-keyed refresh provider, Radix preview, responsive inbox and preferences with explicit pending/error/empty states.
- [ ] Run frontend build/unit/format and browser suites; capture and inspect synthetic desktop dark/light, mobile and preview states; commit UI deliverable.

### Task 3: Operational docs and review

**Files:** `DESIGN.md`, `docs/src/content/docs/guides/notifications.md`, `docs/src/content/docs/operations/requirements.md`, `docs/src/content/docs/operations/deployment.md`, `docs/engineering/lessons-learned.md`, screenshots.

**Interfaces:** Document final event recipients, API/state semantics, refresh/retention, migration and mail extension boundary.

- [ ] Update user and operator documentation, traceability, and concrete encountered failures.
- [ ] Run repository required checks and independent whole-branch review; address material findings with regression tests.
- [ ] Publish reviewed branch and PR with representative screenshots; merge only once required checks pass.
