# A2 browser evidence

All content and accounts in these captures are synthetic test fixtures. Mobile captures wait for the sidebar to finish closing and assert no document horizontal overflow.

| File | State |
| --- | --- |
| restore-desktop-dark.png | Same-account SSO return; saved settings await explicit recovery |
| restore-desktop-light.png | The same recovery choice in light mode |
| restore-mobile-light.png | Recovery choice at 390 × 844 |
| storage-failure-desktop-dark.png | Quota failure; input remains editable and no saved claim appears |
| storage-failure-mobile-dark.png | The same failure at 390 × 844 |
| conflict-desktop-dark.png | Latest decided review with its earlier read-only draft |
| conflict-mobile-dark.png | The same conflict at 390 × 844 |

Regenerate only when explicitly collecting evidence:

```sh
cd frontend
AAG_CAPTURE_EVIDENCE=1 PLAYWRIGHT_BROWSERS_PATH=/private/tmp/aag-playwright npm run test:e2e -- drafts.spec.ts -g 'test_storage_error_is_visible|test_decided_review_preserves_readonly_draft|same-account expiry flushes'
```

Ordinary browser runs do not write this directory.

The SPA leave warning uses the browser-owned native `window.confirm` dialog. Playwright page screenshots do not include browser chrome/native dialogs, so no simulated dialog image is presented. `test_two_dirty_forms_preserved` proves exactly one confirmation for both dirty forms on each attempt, cancellation preserves both inputs and continuing preserves both draft records; `hard reload warns once and cancel keeps both edited forms` verifies the native beforeunload path. The seven images document the corresponding app layout and draft states.

Review round 1 adds synthetic cached-read and permission states:

| File | State |
| --- | --- |
| poll-error-board-desktop-dark.png | Board editor preserved alongside a 503 read error and unavailable draft storage |
| poll-error-board-mobile-dark.png | The same board editor at 390 × 844 |
| poll-error-comment-desktop-dark.png | Review comment preserved alongside a 503 detail-read error |
| poll-error-comment-mobile-dark.png | The same comment at 390 × 844 |
| notice-permission-desktop-dark.png | Public notice after its same-account author loses administrator status; no editing/recovery actions |
| notice-permission-mobile-dark.png | The same permission state at 390 × 844 |

Capture these review states with `AAG_CAPTURE_EVIDENCE=1` and the existing `review_I1.*survive 503` / `review_I2.*reviewer=true` cases. Ordinary runs still write no tracked images.
