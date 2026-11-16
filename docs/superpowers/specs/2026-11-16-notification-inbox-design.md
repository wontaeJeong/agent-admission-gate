# Personal notification inbox

## Intent and scope

Collect scan and review updates in an account-specific inbox, with a bell preview available throughout the authenticated workspace. Email delivery is deferred. Keep the existing Graphite & Plum UI, Korean/English copy, light/dark themes, and mobile navigation.

## Approach

Use transactionally persisted per-recipient notifications in the existing database. Compared with deriving an inbox from audit logs, this supports independent read/archive state and recipient preferences without exposing audit details. A separate broker and streaming connection would add operational infrastructure to the current single-process deployment; use a visibility-aware 30-second summary refresh and focus/online refresh instead. This is an implementation choice within the requested feature.

## Events and recipients

| Event | Recipients |
| --- | --- |
| Scan completed, failed, cancelled (including cache, timeout, shutdown and recovery) | Active scan owner |
| Review requested | Active qualified reviewers except requester; admin role alone does not qualify |
| Review approved or rejected | Active requester |
| Public scan comment | Active scan owner and decided review participant, excluding author |

Never copy source code, comments, decision reasons, raw scanner errors, credentials, or audit payloads into notifications. Generic event labels plus the currently authorized source/scan identifier and verdict are sufficient. Internal comments do not generate notifications.

## Storage and API

Notifications contain recipient, deterministic event key, kind, job/review references, creation/read/archive timestamps and recipient sequence. A counter row locked until transaction commit serializes each recipient's delivery boundary; timestamps or a globally allocated database sequence alone cannot define committed membership. Uniqueness of recipient/event key prevents repeated terminal events or decisions from generating duplicates. Event and notification writes share a transaction. No notification history backfill for pre-feature jobs. Expired records are hidden after 90 days and removed through an operator CLI prune command; counters remain to preserve sequence monotonicity. Index account/state/time and sequence for counts and paging.

Session-only REST APIs provide paginated listing (25 items, newest first with ID tie-break), global and category unread counts, read/unread, archive/restore, filtered mark-all-read with a committed server snapshot sequence/cutoff, and per-category preferences. Require `X-AAG-Account` to match the authenticated user on each read/write, rejecting shared-cookie stale tabs with 409. Clear stale UI and reconcile the session on identity mismatch/401; broadcast explicit authentication changes across tabs. All APIs enforce current ownership/resource access on the server; lost reviewer qualification hides review-request alerts. API keys cannot access the inbox. CSRF uses the existing same-origin guard. Mutations are idempotent and cannot name another recipient. Account preferences apply to future notifications and persist across devices; save only fields changed in a form to preserve unrelated multi-device edits.

## UI and behavior

Topbar bell shows capped unread count (99+), recent five notifications, loading/error/retry and empty states, and a link to the complete inbox. Opening a preview does not mark everything read. Explicitly opening a notification marks it read before navigating; failure keeps the item and offers retry. Keyboard focus and Escape are handled by the existing Radix menu.

`/notifications` provides All / Unread / Archived views, scan/review/comment category filtering, pagination, refresh, individual read/unread and archive/restore, and mark-all-read for the current inbox filter. Mutations disable duplicate actions and report failures without claiming success. Empty/out-of-range pages return to a valid page. Preferences are accessible from the inbox and user settings. A disabled event category leaves existing notifications intact. Account switches and late responses cannot reveal a previous account's notifications. Email controls are not presented as available.

## Validation

Exercise real scan and review transitions, isolation, privilege removal, internal-comment privacy, duplicate events, rollback, cached/recovered/failed jobs, preference suppression, pagination/retention, and same-origin/session-only access. Browser checks cover bell-to-resource navigation, unread state, filters, archive, settings, failure/retry, mobile width and representative light/dark screenshots. Run repository lint, format, backend/frontend/browser/doc suites and migration round trip before publication.
