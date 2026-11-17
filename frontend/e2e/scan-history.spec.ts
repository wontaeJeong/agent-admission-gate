import { expect, test, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
test.use({ ignoreHTTPSErrors: true });
let provider: Awaited<ReturnType<typeof startOidcFixture>>;
test.beforeEach(async () => {
  provider = await startOidcFixture();
});
test.afterEach(async () => {
  await provider.stop();
});
const row = (id: string, created_at = 1) => ({
  id,
  owner_id: "a1-alice",
  source: "https://github.com/example/synthetic.git",
  source_type: "git",
  ref: "main",
  profile: "static",
  status: "COMPLETED",
  resolved_commit: "a".repeat(40),
  target_commit: null,
  created_at,
  verdict: "BLOCK",
  effective_verdict: "REVIEW",
  coverage_complete: false,
  engines: [
    { name: "builtin", status: "completed" },
    { name: "external", status: "failed" },
  ],
  cached: true,
  result: {},
  review: {
    id: "review-" + id,
    status: "pending",
    workflow_state: "in_review",
  },
});
async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto(
    provider.origin + "/jobs?scope=personal&status=COMPLETED&page=1",
  );
  await page
    .getByRole("link", { name: "Sign in with SSO", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scans", exact: true }),
  ).toBeVisible();
}
async function mocks(page: Page) {
  await page.route(/\/api\/scans\/(?:old|current)$/, (route) =>
    route.fulfill({
      json: row(
        route.request().url().endsWith("/old") ? "old" : "current",
        route.request().url().endsWith("/old") ? 1 : 2,
      ),
    }),
  );
  await page.route("**/api/scans/current/history*", (route) =>
    route.fulfill({
      json: {
        items: [row("current", 2), row("old"), row("third", 3)],
        total: 3,
        page: 1,
        page_size: 25,
      },
    }),
  );
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  const dir = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-b2",
  );
  mkdirSync(dir, { recursive: true });
  await page.locator("main").focus();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: resolve(dir, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
}
test("history selects baseline/current, handles comparison entry and retains original list return", async ({
  page,
}) => {
  await login(page);
  await mocks(page);
  // Depart from the actual filtered list through ListLink.
  await page.route(/\/api\/scans\?/, (route) =>
    route.fulfill({ json: { items: [row("current", 2)], total: 1 } }),
  );
  await page.reload();
  await page
    .getByRole("link", {
      name: "https://github.com/example/synthetic.git",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("tab", { name: "History", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Source scan history", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("external: failed");
  await page
    .getByRole("checkbox", { name: "Select scan current", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select scan old", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Select scan third", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Baseline: old", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Current: current", { exact: true }),
  ).toBeVisible();
  await capture(page, "selected-desktop-dark");
  await page
    .getByRole("link", { name: "Open selected scans", exact: true })
    .click();
  await expect(page).toHaveURL(/\/jobs\/current\/compare\?baseline=old$/);
  await expect(
    page.getByRole("heading", { name: "Selected scans", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Metadata only. Findings are not compared.", {
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, "pair-desktop-dark");
  await page.getByRole("link", { name: "Back to scans", exact: true }).click();
  await expect(page).toHaveURL(
    provider.origin + "/jobs?scope=personal&status=COMPLETED&page=1",
  );
});
test("history filters page counts, preserves selection across pages and supports swapping", async ({
  page,
}) => {
  await login(page);
  await mocks(page);
  await page.route("**/api/scans/current/history*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const filtered = query.get("profile") === "full";
    const pageNumber = Number(query.get("page") || 1);
    return route.fulfill({
      json: {
        items: filtered
          ? []
          : [row(pageNumber === 1 ? "old" : "current", pageNumber)],
        total: filtered ? 0 : 26,
        page: pageNumber,
        page_size: 25,
      },
    });
  });
  await page.goto(provider.origin + "/jobs/current?tab=history");
  await page
    .getByRole("checkbox", { name: "Select scan old", exact: true })
    .check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await page
    .getByRole("checkbox", { name: "Select scan current", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Swap baseline and current", exact: true })
    .click();
  await expect(
    page.getByText("Baseline: current", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("History profile", { exact: true })
    .selectOption("full");
  await expect(page).toHaveURL(/page=1/);
  await expect(page.locator(".empty")).toContainText(
    "No scans match these history filters.",
  );
  await expect(
    page.getByRole("link", { name: "Run another scan", exact: true }),
  ).toHaveAttribute("href", "/new?from=current&mode=latest");
  await capture(page, "empty-desktop-dark");
});
test("history mobile table and light/Korean states remain usable", async ({
  page,
}) => {
  await login(page);
  await mocks(page);
  await page.goto(provider.origin + "/jobs/current?tab=history");
  await expect(page.getByRole("table")).toBeVisible();
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await capture(page, "history-desktop-light");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("checkbox", { name: "Select scan current", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select scan old", exact: true })
    .check();
  await expect(
    page.getByRole("link", { name: "Open selected scans", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(page, "selected-mobile-light");
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await capture(page, "selected-mobile-dark");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Account menu: alice", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Display settings", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "한국어", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "동일 대상 검사 이력", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("대기 · 검토 중");
  await expect(page.getByRole("table")).not.toContainText("pending");
  await expect(page.getByRole("table")).not.toContainText("in_review");
  await capture(page, "history-desktop-ko-dark");
});
test("history read error retries and denied pair never shows either scan metadata", async ({
  page,
}) => {
  await login(page);
  await mocks(page);
  let failing = true;
  await page.route("**/api/scans/current/history*", (route) =>
    failing
      ? route.fulfill({
          status: 503,
          json: { detail: "Synthetic history read failure" },
        })
      : route.fulfill({
          json: {
            items: [row("current", 2)],
            total: 1,
            page: 1,
            page_size: 25,
          },
        }),
  );
  await page.goto(provider.origin + "/jobs/current?tab=history");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic history read failure",
  );
  await capture(page, "history-error-desktop-dark");
  failing = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Select scan current", exact: true }),
  ).toBeVisible();
  await page.route("**/api/scans/hidden", (route) =>
    route.fulfill({ status: 404, json: { detail: "Scan not found" } }),
  );
  await page.goto(provider.origin + "/jobs/current/compare?baseline=hidden");
  await expect(page.getByText("Scan not found", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await capture(page, "pair-denied-desktop-dark");
  await page.goto(provider.origin + "/jobs/current/compare?baseline=current");
  await expect(
    page.getByText("Select two different scans.", { exact: true }),
  ).toBeVisible();
});
test("real ZIP history uses lineage and excludes same filenames", async ({
  page,
}) => {
  await login(page);
  const zip = Buffer.from(
    "UEsDBBQAAAAAADBtYVsAAAAAAAAAAAAAAAAJAAAAcmVhZG1lLm1kUEsBAhQDFAAAAAAAMG1hWwAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS5tZFBLBQYAAAAAAQABADcAAAAnAAAAAAA=",
    "base64",
  );
  async function upload(name: string, origin?: string) {
    const response = await page.request.post(
      provider.origin + "/api/scans/upload",
      {
        headers: { Origin: provider.origin, "X-AAG-Account": "a1-alice" },
        multipart: {
          file: { name, mimeType: "application/zip", buffer: zip },
          ...(origin ? { origin_job_id: origin } : {}),
        },
      },
    );
    expect(response.status()).toBe(202);
    return response.json();
  }
  const root = await upload("same.zip");
  const linked = await upload("renamed.zip", root.id);
  const unrelated = await upload("same.zip");
  await page.goto(provider.origin + "/jobs/" + root.id + "?tab=history");
  await expect(page.getByRole("table")).toContainText(linked.id);
  await expect(page.getByRole("table")).not.toContainText(unrelated.id);
  await expect(page.getByRole("table")).toContainText("renamed.zip");
  await capture(page, "zip-history-desktop-dark");
});
test("history filters survive SSO return without unknown queries", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await mocks(page);
  await page.goto(
    provider.origin +
      "/jobs/current?tab=history&ref=release&profile=full&status=COMPLETED&page=2&page_size=25&token=synthetic-secret",
  );
  await page
    .getByRole("link", { name: "Sign in with SSO", exact: true })
    .click();
  await expect(page).toHaveURL(
    provider.origin +
      "/jobs/current?tab=history&ref=release&profile=full&status=COMPLETED&page=2&page_size=25",
  );
  await expect(
    page.getByRole("heading", { name: "Source scan history", exact: true }),
  ).toBeVisible();
});
