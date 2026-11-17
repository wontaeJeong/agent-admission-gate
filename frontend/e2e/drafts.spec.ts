import { expect, test, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const job = {
  id: "draft-job",
  owner_id: "requester",
  source: "synthetic-package.zip",
  source_type: "zip",
  ref: null,
  profile: "static",
  status: "COMPLETED",
  verdict: "REVIEW",
  effective_verdict: "REVIEW",
  error: null,
  created_at: 1760000000,
  started_at: 1760000001,
  completed_at: 1760000002,
  resolved_commit: null,
  content_hash: null,
  cached_from: null,
  review: null,
  result: { findings: [], engines: [], coverage_complete: true },
};
async function fixture(page: Page) {
  let account = "reviewer",
    qualified = true,
    status = "pending",
    role = "user";
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.route("**/api/auth/config", (r) =>
    r.fulfill({ json: { mode: "local", boards_enabled: true } }),
  );
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({
      json: { id: account, name: account, role, reviewer: qualified },
    }),
  );
  await page.route("**/api/profile", (r) =>
    r.fulfill({
      json: {
        account_name: account,
        display_name: null,
        role,
        reviewer: qualified,
      },
    }),
  );
  await page.route("**/api/notifications/unread-count", (r) =>
    r.fulfill({ json: { unread_count: 0 } }),
  );
  await page.route("**/api/scans?**", (r) =>
    r.fulfill({ json: { items: [], total: 0, page: 1 } }),
  );
  await page.route("**/api/scans/draft-job", (r) =>
    r.fulfill({ json: { ...job, owner_id: account } }),
  );
  await page.route("**/api/reviews/draft-review", (r) =>
    r.fulfill({
      json: {
        id: "draft-review",
        job_id: job.id,
        requester_id: "requester",
        reason: "Synthetic request context",
        status,
        reviewer_id: status === "pending" ? null : "other-reviewer",
        decision_reason: status === "pending" ? null : "Latest server decision",
        created_at: 1760000003,
        decided_at: status === "pending" ? null : 1760000004,
        job,
      },
    }),
  );
  await page.route("**/api/scans/draft-job/comments", (r) =>
    r.fulfill({ json: [] }),
  );
  return {
    setRole(value: string, reviewer: boolean) {
      role = value;
      qualified = reviewer;
    },
    setAccount(value: string) {
      account = value;
    },
    decide() {
      status = "rejected";
    },
    revoke() {
      qualified = false;
    },
  };
}
async function withConfirm(
  page: Page,
  accept: boolean,
  action: () => Promise<unknown>,
) {
  const handled = new Promise<void>((done) =>
    page.once("dialog", async (dialog) => {
      if (accept) await dialog.accept();
      else await dialog.dismiss();
      done();
    }),
  );
  await action();
  await handled;
}
async function leave(page: Page, accept: boolean) {
  await withConfirm(page, accept, () =>
    page.getByRole("link", { name: "Scans", exact: true }).click(),
  );
}
async function reload(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  const directory = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-a2",
  );
  mkdirSync(directory, { recursive: true });
  // Full-page Chromium captures otherwise offset fixed chrome after focus scroll.
  // Scrolling does not blur the active form; the preservation assertions still run.
  await page.evaluate(() =>
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
  );
  await page.screenshot({
    path: resolve(directory, name + ".png"),
    fullPage: true,
  });
}
async function mobile(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await page.locator(".sidebar").boundingBox();
      return box ? box.x + box.width : 0;
    })
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
}
test("test_two_dirty_forms_preserved", async ({ page }) => {
  await fixture(page);
  await page.goto("/reviews/draft-review");
  await page
    .getByLabel("Decision reason", { exact: true })
    .fill("Synthetic unsent decision");
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Synthetic unsent comment");
  let dialogs = 0;
  const countDialog = () => {
    dialogs++;
  };
  page.on("dialog", countDialog);
  await leave(page, false);
  await expect(page).toHaveURL(/\/reviews\/draft-review$/);
  await expect(page.getByLabel("Decision reason", { exact: true })).toHaveValue(
    "Synthetic unsent decision",
  );
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue(
    "Synthetic unsent comment",
  );
  expect(dialogs).toBe(1);
  await leave(page, true);
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(
    page.getByRole("heading", { name: "Scans", exact: true }),
  ).toBeVisible();
  expect(dialogs).toBe(2);
  page.off("dialog", countDialog);
  await page.goto("/reviews/draft-review");
  await expect(
    page.getByRole("button", { name: "Restore previous draft" }),
  ).toHaveCount(2);
  await expect(page.getByLabel("Decision reason", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByRole("button", { name: "Restore previous draft" })
    .first()
    .click();
  await page.getByRole("button", { name: "Restore previous draft" }).click();
  await expect(page.getByLabel("Decision reason", { exact: true })).toHaveValue(
    "Synthetic unsent decision",
  );
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue(
    "Synthetic unsent comment",
  );
});
test("test_account_switch_never_restores_foreign_draft", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/new");
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://example.test/alice");
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toBeVisible();
  state.setAccount("bob");
  await page.evaluate(() => {
    localStorage.setItem("aag-auth-observed-account", "bob");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aag-auth-change" }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Account menu: bob" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore previous draft" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    "",
  );
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith("aag-draft:")),
    ),
  ).toEqual([]);
});
test("test_storage_error_is_visible", async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("aag-draft:"))
        throw new DOMException(
          "Synthetic quota exceeded",
          "QuotaExceededError",
        );
      return real.call(this, key, value);
    };
  });
  await page.goto("/new");
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://example.test/repo");
  await expect(page.getByRole("alert")).toContainText("Draft was not saved");
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    "https://example.test/repo",
  );
  await capture(page, "storage-failure-desktop-dark");
  await mobile(page);
  await capture(page, "storage-failure-mobile-dark");
});
test("test_decided_review_preserves_readonly_draft", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/reviews/draft-review");
  await page
    .getByLabel("Decision reason", { exact: true })
    .fill("Earlier unsent decision");
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toBeVisible();
  state.decide();
  await reload(page);
  await expect(
    page.locator(".review-reason").getByText("Latest server decision"),
  ).toBeVisible();
  await expect(page.getByLabel("Read-only draft")).toContainText(
    "Earlier unsent decision",
  );
  await expect(
    page.getByRole("button", { name: "Restore previous draft" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save decision" })).toHaveCount(
    0,
  );
  await capture(page, "conflict-desktop-dark");
  await mobile(page);
  await capture(page, "conflict-mobile-dark");
});
test("test_tab_change_flushes", async ({ page }) => {
  await fixture(page);
  await page.goto("/jobs/draft-job?tab=comments");
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Immediate tab transition");
  await withConfirm(page, false, () =>
    page.getByRole("tab", { name: "Findings", exact: true }).click(),
  );
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue(
    "Immediate tab transition",
  );
  await withConfirm(page, true, () =>
    page.getByRole("tab", { name: "Findings", exact: true }).click(),
  );
  await expect(page).toHaveURL(/tab=findings/);
  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  await page.getByRole("button", { name: "Restore previous draft" }).click();
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue(
    "Immediate tab transition",
  );
});

let provider: Awaited<ReturnType<typeof startOidcFixture>>;
test.use({ ignoreHTTPSErrors: true });
test.beforeAll(async () => {
  provider = await startOidcFixture();
});
test.afterAll(async () => {
  if (provider) await provider.stop();
});
test("same-account expiry flushes and survives full-document SSO without PAT or ZIP", async ({
  page,
  context,
}) => {
  await page.goto(provider.origin + "/new");
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await page
    .getByLabel("저장소 URL", { exact: true })
    .fill("https://example.test/repo");
  await page
    .getByLabel("브랜치 또는 태그", { exact: true })
    .fill("feature/synthetic");
  await page.getByText("비공개 저장소 인증", { exact: true }).click();
  await page
    .getByLabel("Personal access token", { exact: true })
    .fill("synthetic-PAT-never-persist");
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("alert").filter({ hasText: "세션이 만료" }),
  ).toHaveCount(1);
  const raw = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("aag-draft:"))
      .map(([, value]) => value)
      .join(""),
  );
  expect(raw).toContain("feature/synthetic");
  expect(raw).not.toContain("synthetic-PAT-never-persist");
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await expect(
    page.getByRole("button", { name: "이전 작성 내용 복구" }),
  ).toBeVisible();
  await expect(page.getByLabel("저장소 URL", { exact: true })).toHaveValue("");
  await capture(page, "restore-desktop-dark");
  await page.getByRole("button", { name: /계정 메뉴/ }).click();
  await page.getByRole("menuitem", { name: "라이트 모드" }).click();
  await capture(page, "restore-desktop-light");
  await mobile(page);
  await capture(page, "restore-mobile-light");
  await page.getByRole("button", { name: "이전 작성 내용 복구" }).click();
  await expect(
    page.getByLabel("브랜치 또는 태그", { exact: true }),
  ).toHaveValue("feature/synthetic");
  await page.getByText("비공개 저장소 인증", { exact: true }).click();
  await expect(
    page.getByLabel("Personal access token", { exact: true }),
  ).toHaveValue("");
});
test("ZIP must be selected again after restoring allowed upload settings", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/new");
  await page.getByRole("tab", { name: "Upload package" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("synthetic-only"),
  });
  await page.getByRole("radio", { name: /^Full/ }).check();
  await reload(page);
  await page.getByRole("button", { name: "Restore previous draft" }).click();
  await expect(
    page.getByRole("tab", { name: "Upload package" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    await page
      .locator('input[type="file"]')
      .evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(0);
  expect(
    await page.evaluate(() =>
      Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith("aag-draft:"))
        .map(([, value]) => value)
        .join(""),
    ),
  ).not.toContain("synthetic.zip");
});
test("explicit sign-out clears drafts before unmount cleanup can save them", async ({
  page,
}) => {
  await page.goto(provider.origin + "/new");
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await page
    .getByLabel("저장소 URL", { exact: true })
    .fill("https://example.test/logout");
  await page.getByRole("button", { name: /계정 메뉴/ }).click();
  await page.getByRole("menuitem", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("link", { name: "SSO로 로그인" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith("aag-draft:")),
    ),
  ).toEqual([]);
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await expect(page.getByLabel("저장소 URL", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "이전 작성 내용 복구" }),
  ).toHaveCount(0);
});
test("a lost internal-comment qualification removes the draft before showing recovery", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/reviews/draft-review");
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Synthetic internal-only note");
  await page.getByRole("checkbox", { name: "Staff only" }).check();
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toBeVisible();
  state.revoke();
  await reload(page);
  await expect(
    page.getByRole("button", { name: "Restore previous draft" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("");
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith("aag-draft:")),
    ),
  ).toEqual([]);
});
test("a target permission failure does not reveal its stored draft", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/reviews/draft-review");
  await page
    .getByLabel("Decision reason", { exact: true })
    .fill("Private prior draft");
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toBeVisible();
  await page.route("**/api/reviews/draft-review", (route) =>
    route.fulfill({ status: 404, json: { detail: "Review unavailable" } }),
  );
  await reload(page);
  await expect(page.getByRole("alert")).toContainText("Review unavailable");
  await expect(
    page.getByRole("button", { name: "Restore previous draft" }),
  ).toHaveCount(0);
  await expect(page.getByText("Private prior draft")).toHaveCount(0);
});
test("successful submission clears only that form and keeps the other dirty draft", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/scans/draft-job/comments", (route) =>
    route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json:
        route.request().method() === "POST" ? { id: "synthetic-comment" } : [],
    }),
  );
  await page.goto("/reviews/draft-review");
  await page
    .getByLabel("Decision reason", { exact: true })
    .fill("Decision still in progress");
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Comment ready to submit");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("");
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("aag-draft:"))
      .map(([, raw]) => JSON.parse(raw)),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    kind: "review_decision",
    fields: { reason: "Decision still in progress" },
  });
});
test("visibilitychange synchronously flushes the latest keystroke before debounce", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/new");
  await page.clock.install({ time: new Date("2026-11-17T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-17T00:01:00Z"));
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://example.test/visibility");
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  expect(
    await page.evaluate(
      () =>
        Object.entries(sessionStorage)
          .filter(([key]) => key.startsWith("aag-draft:"))
          .map(([, raw]) => JSON.parse(raw))[0]?.fields.url,
    ),
  ).toBe("https://example.test/visibility");
});

test("board editor close uses the shared warning and revision changes require explicit re-edit", async ({
  page,
}) => {
  await fixture(page);
  let revision = 1;
  await page.route("**/api/boards?**", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1 } }),
  );
  await page.route("**/api/boards/draft-post", (route) =>
    route.fulfill({
      json: {
        id: "draft-post",
        author_id: "reviewer",
        author: "Synthetic author",
        kind: "voc",
        title: "Latest title",
        body: revision === 1 ? "Original server body" : "Changed server body",
        visibility: "public",
        status: "open",
        pinned: false,
        revision,
        updated_at: 1760000000,
      },
    }),
  );
  await page.route("**/api/boards/draft-post/comments", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/boards/draft-post");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Unsent synthetic title");
  await page.getByLabel("Body", { exact: true }).fill("Unsent synthetic body");
  await withConfirm(page, false, () =>
    page.getByRole("button", { name: "Edit", exact: true }).click(),
  );
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue(
    "Unsent synthetic body",
  );
  await withConfirm(page, true, () =>
    page.getByRole("button", { name: "Edit", exact: true }).click(),
  );
  await expect(page.getByLabel("Body", { exact: true })).toHaveCount(0);
  revision = 2;
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Read-only draft")).toContainText(
    "Unsent synthetic body",
  );
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue(
    "Changed server body",
  );
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Re-edit draft against latest" })
    .click();
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue(
    "Unsent synthetic body",
  );
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
});
test("draft storage getter failures remain visible without losing the current form", async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() =>
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Unavailable", "SecurityError");
      },
    }),
  );
  await page.goto("/new");
  await expect(
    page.getByRole("alert").filter({ hasText: "Draft storage is unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Draft was not saved" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Start a new scan" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Repository URL", { exact: true }),
  ).toBeEditable();
});
test("drafts debounce for 300ms and pagehide flushes without waiting", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/new");
  await page.clock.install({ time: new Date("2026-11-17T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-17T00:01:00Z"));
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://example.test/debounce");
  const records = () =>
    page.evaluate(() =>
      Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith("aag-draft:"))
        .map(([, raw]) => JSON.parse(raw)),
    );
  await page.clock.fastForward(299);
  expect(await records()).toHaveLength(0);
  await page.clock.fastForward(1);
  expect((await records())[0].fields.url).toBe("https://example.test/debounce");
  await page
    .getByLabel("Branch or tag", { exact: true })
    .fill("last-keystroke");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect((await records())[0].fields.ref).toBe("last-keystroke");
});

test("explicit logout observation clears drafts even while this tab is already expired", async ({
  page,
  context,
}) => {
  await page.goto(provider.origin + "/new");
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await page
    .getByLabel("저장소 URL", { exact: true })
    .fill("https://example.test/expired-logout");
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("alert").filter({ hasText: "세션이 만료" }),
  ).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith("aag-draft:")),
    ),
  ).toHaveLength(1);
  await page.evaluate(() => {
    localStorage.setItem("aag-auth-observed-account", "");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aag-auth-change" }),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("aag-draft:"),
        ),
      ),
    )
    .toEqual([]);
});

for (const kind of ["scan", "review"] as const) {
  test(`same-component ${kind} target navigation never carries another target's fields`, async ({
    page,
  }) => {
    await fixture(page);
    const originalPath =
      kind === "scan" ? "/jobs/draft-job" : "/reviews/draft-review";
    const targetPath =
      kind === "scan" ? "/jobs/other-job" : "/reviews/other-review";
    let destination = targetPath;
    await page.route("**/api/notifications?**", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "draft-navigation",
              kind: "review.requested",
              source: "Open synthetic target",
              href: destination,
              verdict: null,
              created_at: 1760000000,
              read_at: 1760000001,
              archived_at: null,
            },
          ],
          total: 1,
          unread_count: 0,
          filtered_unread_count: 0,
          snapshot_at: 1760000002,
          snapshot_sequence: 1,
        },
      }),
    );
    await page.route("**/api/scans/other-job", (route) =>
      route.fulfill({
        json: { ...job, id: "other-job", owner_id: "reviewer" },
      }),
    );
    await page.route("**/api/scans/other-job/comments", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route("**/api/reviews/other-review", (route) =>
      route.fulfill({
        json: {
          id: "other-review",
          job_id: "other-job",
          requester_id: "requester",
          reason: "Other target context",
          status: "pending",
          reviewer_id: null,
          decision_reason: null,
          created_at: 1760000003,
          decided_at: null,
          job: { ...job, id: "other-job" },
        },
      }),
    );
    await page.goto(originalPath);
    const reasonLabel = kind === "scan" ? "Reason" : "Decision reason";
    await page
      .getByLabel(reasonLabel, { exact: true })
      .fill("Reason belonging to original target");
    if (kind === "review")
      await page
        .getByLabel("Comment", { exact: true })
        .fill("Comment belonging to original target");
    await page.getByRole("button", { name: "Notifications, 0 unread" }).click();
    await withConfirm(page, true, () =>
      page
        .getByRole("menuitem")
        .filter({ hasText: "Open synthetic target" })
        .click(),
    );
    await expect(page).toHaveURL(new RegExp(targetPath + "$"));
    await expect(page.getByLabel(reasonLabel, { exact: true })).toHaveValue("");
    if (kind === "review")
      await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Restore previous draft" }),
    ).toHaveCount(0);
    destination = originalPath;
    await page.getByRole("button", { name: "Notifications, 0 unread" }).click();
    await page
      .getByRole("menuitem")
      .filter({ hasText: "Open synthetic target" })
      .click();
    await expect(
      page.getByRole("button", { name: "Restore previous draft" }),
    ).toHaveCount(kind === "scan" ? 1 : 2);
  });
}
test("boards disabled hides stored board drafts and every board editor", async ({
  page,
}) => {
  await fixture(page);
  let enabled = true;
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({ json: { mode: "local", boards_enabled: enabled } }),
  );
  await page.route("**/api/boards?**", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1 } }),
  );
  await page.goto("/boards?kind=voc");
  await page.getByRole("button", { name: "Write a post" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Synthetic flagged draft");
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toBeVisible();
  enabled = false;
  await reload(page);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore previous draft" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Notices · Feedback" }),
  ).toHaveCount(0);
});

test("hard reload warns once and cancel keeps both edited forms", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/reviews/draft-review");
  await page
    .getByLabel("Decision reason", { exact: true })
    .fill("Before unload decision");
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Before unload comment");
  let dialogType = "";
  const handled = new Promise<void>((done) =>
    page.once("dialog", async (dialog) => {
      dialogType = dialog.type();
      await dialog.dismiss();
      done();
    }),
  );
  await page.evaluate(() => location.reload());
  await handled;
  expect(dialogType).toBe("beforeunload");
  await expect(page.getByLabel("Decision reason", { exact: true })).toHaveValue(
    "Before unload decision",
  );
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue(
    "Before unload comment",
  );
});
test("a live board revision cannot silently rebase edited fields", async ({
  page,
}) => {
  await fixture(page);
  let revision = 1;
  let submittedRevision: number | null = null;
  await page.route("**/api/boards/live-post", (route) => {
    if (route.request().method() === "PUT") {
      submittedRevision = route.request().postDataJSON().revision;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({
      json: {
        id: "live-post",
        author_id: "reviewer",
        author: "Synthetic author",
        kind: "voc",
        title: "Current server title",
        body: `Server revision ${revision}`,
        visibility: "public",
        status: "open",
        pinned: false,
        revision,
        updated_at: 1760000000,
      },
    });
  });
  await page.route("**/api/boards/live-post/comments", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/boards/live-post");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.clock.install({ time: new Date("2026-11-17T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-17T00:01:00Z"));
  await page
    .getByLabel("Body", { exact: true })
    .fill("Edited against revision one");
  await page.clock.fastForward(300);
  revision = 2;
  await page.clock.fastForward(4000);
  await expect(page.getByLabel("Read-only draft")).toContainText(
    "Edited against revision one",
  );
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        Object.entries(sessionStorage)
          .filter(([key]) => key.startsWith("aag-draft:"))
          .map(([, raw]) => JSON.parse(raw))[0].base_revision,
    ),
  ).toBe(1);
  await page
    .getByRole("button", { name: "Re-edit draft against latest" })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => submittedRevision).toBe(2);
});

test("another unauthenticated tab does not turn same-account expiry into explicit logout", async ({
  page,
  context,
}) => {
  await page.goto(provider.origin + "/new");
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await page
    .getByLabel("저장소 URL", { exact: true })
    .fill("https://example.test/expiry-other-tab");
  await expect(
    page.getByText("이 탭에 임시저장", { exact: false }),
  ).toBeVisible();
  await context.clearCookies();
  const second = await context.newPage();
  await second.goto(provider.origin + "/new");
  await expect(
    second.getByRole("link", { name: "SSO로 로그인" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith("aag-draft:")),
    ),
  ).toHaveLength(1);
});

test("qualification loss removes internal drafts even when the target becomes unreadable", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/reviews/draft-review");
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Internal draft on inaccessible target");
  await page.getByRole("checkbox", { name: "Staff only" }).check();
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toBeVisible();
  await page.clock.install({ time: new Date("2026-11-17T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-17T00:01:00Z"));
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Last internal keystroke before qualification loss");
  state.revoke();
  await page.route("**/api/reviews/draft-review", (route) =>
    route.fulfill({
      status: 404,
      json: { detail: "Review unavailable after qualification loss" },
    }),
  );
  // Same-account reconciliation must invalidate the old generation before pruning.
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aag-auth-change" }),
    ),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Review unavailable after qualification loss",
  );
  await page.clock.fastForward(1000);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
  });
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith("aag-draft:")),
    ),
  ).toEqual([]);
});

async function rejectDraftWrites(page: Page) {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("aag-draft:"))
        throw new DOMException(
          "Synthetic unavailable draft storage",
          "QuotaExceededError",
        );
      return setItem.call(this, key, value);
    };
  });
}
const reviewPost = (kind = "voc") => ({
  id: "review-post",
  author_id: "reviewer",
  author: "Synthetic author",
  kind,
  title: "Synthetic post",
  body: "Server body",
  visibility: "public",
  status: "open",
  pinned: false,
  revision: 1,
  updated_at: 1760000000,
});
for (const form of ["board", "comment"] as const) {
  for (const failure of [500, 503, "network"] as const) {
    test(`review_I1 ${form} input and focus survive ${failure} polling with unavailable storage`, async ({
      page,
    }) => {
      await fixture(page);
      await rejectDraftWrites(page);
      let fail = false,
        denied = false;
      const path =
        form === "board" ? "/boards/review-post" : "/reviews/draft-review";
      const endpoint =
        form === "board"
          ? "**/api/boards/review-post"
          : "**/api/reviews/draft-review";
      if (form === "board")
        await page.route("**/api/boards/review-post/comments", (r) =>
          r.fulfill({ json: [] }),
        );
      await page.route(endpoint, (route) => {
        if (denied)
          return route.fulfill({
            status: 403,
            json: { detail: "Synthetic permission removed" },
          });
        if (fail)
          return failure === "network"
            ? route.abort("failed")
            : route.fulfill({
                status: failure,
                json: { detail: "Synthetic poll unavailable" },
              });
        if (form === "board") return route.fulfill({ json: reviewPost() });
        return route.fallback();
      });
      await page.goto(path);
      if (form === "board")
        await page.getByRole("button", { name: "Edit", exact: true }).click();
      const field = page.getByLabel(form === "board" ? "Body" : "Comment", {
        exact: true,
      });
      await field.fill("Input must survive a transient read without storage");
      await expect(
        page.getByRole("alert").filter({ hasText: "Draft was not saved" }),
      ).toBeVisible();
      await field.evaluate((node) =>
        node.setAttribute("data-form-instance", "original"),
      );
      fail = true;
      await expect(
        page.getByRole("alert").filter({
          hasText:
            failure === "network"
              ? "Failed to fetch"
              : "Synthetic poll unavailable",
        }),
      ).toBeVisible({ timeout: 7000 });
      await expect(field).toHaveAttribute("data-form-instance", "original");
      await expect(field).toHaveValue(
        "Input must survive a transient read without storage",
      );
      await expect(field).toBeFocused();
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }),
      ).toBeVisible();
      if (failure === 503) {
        await capture(page, `poll-error-${form}-desktop-dark`);
        await mobile(page);
        await capture(page, `poll-error-${form}-mobile-dark`);
      }
      fail = false;
      await expect(
        page.getByRole("alert").filter({
          hasText:
            failure === "network"
              ? "Failed to fetch"
              : "Synthetic poll unavailable",
        }),
      ).toHaveCount(0, { timeout: 7000 });
      await expect(field).toHaveAttribute("data-form-instance", "original");
      await expect(field).toHaveValue(
        "Input must survive a transient read without storage",
      );
      await expect(field).toBeFocused();
      denied = true;
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Synthetic permission removed" }),
      ).toBeVisible({ timeout: 7000 });
      await expect(field).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }),
      ).toHaveCount(0);
    });
  }
}
for (const reviewer of [false, true]) {
  test(`review_I2 a demoted notice author cannot edit or recover writable drafts (reviewer=${reviewer})`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.setRole("admin", true);
    await page.route("**/api/boards/review-post", (r) =>
      r.fulfill({ json: reviewPost("notice") }),
    );
    await page.route("**/api/boards/review-post/comments", (r) =>
      r.fulfill({ json: [] }),
    );
    await page.goto("/boards/review-post");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Body", { exact: true })
      .fill("Earlier administrator notice draft");
    await expect(
      page.getByText("Saved in this tab", { exact: false }),
    ).toBeVisible();
    state.setRole("user", reviewer);
    await page.evaluate(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: "aag-auth-change" }),
      ),
    );
    await expect(page.locator(".sidebar-footer")).toContainText(
      reviewer ? "user · reviewer" : "user",
    );
    await expect(
      page.getByRole("heading", { name: "Synthetic post", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Restore previous draft" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Re-edit draft against latest" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toHaveCount(0);
    if (reviewer) {
      await capture(page, "notice-permission-desktop-dark");
      await mobile(page);
      await capture(page, "notice-permission-mobile-dark");
    }
  });
}
for (const reopen of [true, false]) {
  test(`review_I3 a late comment success preserves the newer ${reopen ? "replacement" : "same-instance"} draft`, async ({
    page,
  }) => {
    await fixture(page);
    let release!: () => void;
    let submitted = false;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    await page.route("**/api/scans/draft-job/comments", async (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({ json: [] });
      submitted = true;
      await hold;
      await route.fulfill({ status: 201, json: { id: "old-comment" } });
    });
    await page.goto("/reviews/draft-review");
    await page
      .getByLabel("Comment", { exact: true })
      .fill("Old comment submission");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect.poll(() => submitted).toBe(true);
    if (reopen) {
      await leave(page, true);
      await expect(
        page.getByRole("heading", { name: "Scans", exact: true }),
      ).toBeVisible();
      await page.goBack();
      await page
        .getByRole("button", { name: "Restore previous draft" })
        .click();
    }
    await page
      .getByLabel("Comment", { exact: true })
      .fill("Newer comment draft");
    await expect(
      page.getByText("Saved in this tab", { exact: false }),
    ).toBeVisible();
    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/scans/draft-job/comments") &&
        r.request().method() === "POST",
    );
    release();
    await (await completed).finished();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });
    await expect(page.getByLabel("Comment", { exact: true })).toHaveValue(
      "Newer comment draft",
    );
    expect(
      await page.evaluate(
        () =>
          Object.entries(sessionStorage)
            .filter(([key]) => key.startsWith("aag-draft:"))
            .map(([, raw]) => JSON.parse(raw))
            .find((d) => d.kind === "scan_comment")?.fields.body,
      ),
    ).toBe("Newer comment draft");
  });
}
test("review_I3 an old scan success cannot navigate away or delete a replacement scan draft", async ({
  page,
}) => {
  await fixture(page);
  let release!: () => void;
  let submitted = false;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/scans", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submitted = true;
    await hold;
    await route.fulfill({
      status: 202,
      json: { ...job, id: "old-created-job" },
    });
  });
  await page.goto("/new");
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://example.test/old-submitted");
  await page.getByRole("button", { name: "Run scan", exact: true }).click();
  await expect.poll(() => submitted).toBe(true);
  await leave(page, true);
  await expect(
    page.getByRole("heading", { name: "Scans", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Restore previous draft" }).click();
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://example.test/newer-draft");
  await expect(
    page.getByText("Saved in this tab", { exact: false }),
  ).toBeVisible();
  let unwantedDialogs = 0;
  const acceptUnexpected = async (
    dialog: import("@playwright/test").Dialog,
  ) => {
    unwantedDialogs++;
    await dialog.accept();
  };
  page.on("dialog", acceptUnexpected);
  const completed = page.waitForResponse(
    (r) => r.url().endsWith("/api/scans") && r.request().method() === "POST",
  );
  release();
  await (await completed).finished();
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  expect(unwantedDialogs).toBe(0);
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    "https://example.test/newer-draft",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(
    await page.evaluate(
      () =>
        Object.entries(sessionStorage)
          .filter(([key]) => key.startsWith("aag-draft:"))
          .map(([, raw]) => JSON.parse(raw))
          .find((d) => d.kind === "scan_new")?.fields.url,
    ),
  ).toBe("https://example.test/newer-draft");
  page.off("dialog", acceptUnexpected);
});

test("review_I1 explicit retry retains a cached editor until the replacement read succeeds", async ({
  page,
}) => {
  await fixture(page);
  await rejectDraftWrites(page);
  let failure = false,
    retryPending = false;
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/boards/review-post", async (route) => {
    if (retryPending) await held;
    if (failure)
      return route.fulfill({
        status: 503,
        json: { detail: "Synthetic retryable read" },
      });
    return route.fulfill({ json: reviewPost() });
  });
  await page.route("**/api/boards/review-post/comments", (r) =>
    r.fulfill({ json: [] }),
  );
  await page.goto("/boards/review-post");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const body = page.getByLabel("Body", { exact: true });
  await body.fill("Unstored input during explicit retry");
  await body.evaluate((node) =>
    node.setAttribute("data-form-instance", "retry-original"),
  );
  failure = true;
  await expect(
    page.getByRole("alert").filter({ hasText: "Synthetic retryable read" }),
  ).toBeVisible({ timeout: 7000 });
  failure = false;
  retryPending = true;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(body).toHaveAttribute("data-form-instance", "retry-original");
  await expect(body).toHaveValue("Unstored input during explicit retry");
  release();
  await expect(
    page.getByRole("alert").filter({ hasText: "Synthetic retryable read" }),
  ).toHaveCount(0);
  await expect(body).toHaveAttribute("data-form-instance", "retry-original");
  await expect(body).toHaveValue("Unstored input during explicit retry");
});

test("review_I1 a conflicting review request stays read-only when its refresh fails", async ({
  page,
}) => {
  await fixture(page);
  await rejectDraftWrites(page);
  let conflict = false;
  await page.route("**/api/scans/draft-job", (route) =>
    conflict
      ? route.fulfill({
          status: 503,
          json: { detail: "Latest review status unavailable" },
        })
      : route.fulfill({ json: { ...job, owner_id: "reviewer" } }),
  );
  await page.route("**/api/scans/draft-job/review", (route) => {
    conflict = true;
    return route.fulfill({
      status: 409,
      json: { detail: "Review already exists" },
    });
  });
  await page.goto("/jobs/draft-job");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Unstored reason must remain readable after conflict");
  await page
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Latest review status unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request review", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Read-only draft")).toContainText(
    "Unstored reason must remain readable after conflict",
  );
});

for (const recovery of ["re-edit", "discard"] as const) {
  test(`review_I1 board revision conflicts stay blocked through failed/stale reads and reopen (${recovery})`, async ({
    page,
  }) => {
    await fixture(page);
    let conflict = false,
      allowRead = false,
      observedRevision = 1;
    const submittedRevisions: number[] = [];
    await page.route("**/api/boards/review-post", (route) => {
      if (route.request().method() === "PUT") {
        submittedRevisions.push(route.request().postDataJSON().revision);
        if (submittedRevisions.length === 1) {
          conflict = true;
          return route.fulfill({
            status: 409,
            json: { detail: "Post changed; reload before editing" },
          });
        }
        return route.fulfill({ json: { ok: true } });
      }
      if (conflict && !allowRead)
        return route.fulfill({
          status: 503,
          json: { detail: "Latest post revision unavailable" },
        });
      return route.fulfill({
        json: {
          ...reviewPost(),
          revision: observedRevision,
          body: conflict
            ? observedRevision === 1
              ? "Stale server revision one"
              : "Server revision two"
            : "Server body",
        },
      });
    });
    await page.route("**/api/boards/review-post/comments", (r) =>
      r.fulfill({ json: [] }),
    );
    await page.goto("/boards/review-post");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Body", { exact: true })
      .fill("User edit against revision one");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Latest post revision unavailable" }),
    ).toBeVisible({ timeout: 7000 });
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel("Read-only draft")).toContainText(
      "User edit against revision one",
    );
    await expect(
      page.getByRole("button", { name: "Re-edit draft against latest" }),
    ).toHaveCount(0);
    await withConfirm(page, true, () =>
      page.getByRole("button", { name: "Edit", exact: true }).click(),
    );
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    const latest = page
      .locator("details")
      .filter({ hasText: "Latest server content" });
    allowRead = true;
    await expect(latest).toContainText("Stale server revision one", {
      timeout: 7000,
    });
    await expect(
      page.getByRole("button", { name: "Re-edit draft against latest" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    if (recovery === "discard")
      await page
        .getByRole("button", { name: "Discard draft", exact: true })
        .click();
    observedRevision = 2;
    if (recovery === "re-edit") {
      await expect(
        page.getByRole("button", { name: "Re-edit draft against latest" }),
      ).toBeVisible({ timeout: 7000 });
      await expect(
        page.getByRole("button", { name: "Save", exact: true }),
      ).toBeDisabled();
      await page.getByText("Latest server content", { exact: true }).click();
      await expect(latest).toContainText("Server revision two");
      await page
        .getByRole("button", { name: "Re-edit draft against latest" })
        .click();
      await expect(page.getByLabel("Body", { exact: true })).toHaveValue(
        "User edit against revision one",
      );
    } else {
      await expect(page.getByLabel("Body", { exact: true })).toHaveValue(
        "Server revision two",
        { timeout: 7000 },
      );
    }
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => submittedRevisions).toEqual([1, 2]);
  });
}
