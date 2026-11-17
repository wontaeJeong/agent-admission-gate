import { test, expect, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
test.use({ ignoreHTTPSErrors: true });

let fixture: Awaited<ReturnType<typeof startOidcFixture>>;
test.beforeAll(async () => {
  fixture = await startOidcFixture({ search: true, reviewWorkflow: true });
});
test.afterAll(async () => {
  await fixture.stop();
});
async function open(page: Page, query = "q=CVE-2026&type=findings") {
  await page.goto(fixture.origin + "/search?" + query);
  await page.getByRole("link", { name: /SSO/ }).click();
  await expect(
    page.getByRole("heading", { name: /Search|검색/ }),
  ).toBeVisible();
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement)?.blur();
  });
  const directory = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-e2",
  );
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, "search-" + name + ".png"),
    fullPage: true,
  });
}
test("authorized finding search, full-order occurrence and URL back", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("link", { name: "CVE-2026-1234 second" }),
  ).toBeVisible();
  await capture(page, "desktop-dark");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await capture(page, "desktop-light");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.getByRole("tab", { name: /Scans|검사/ }).click();
  await page.getByLabel(/Search query|검색어/).fill("synthetic");
  await expect(
    page.getByRole("link", { name: "synthetic-package.zip" }),
  ).toBeVisible();
  await capture(page, "scans");
  await page.getByRole("tab", { name: /Reviews|검토/ }).click();
  await expect(page).toHaveURL(/type=reviews/);
  await expect(page.getByRole("tab", { name: /Reviews|검토/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("search-review", { exact: true })).toBeVisible();
  await expect(page.getByText(/Synthetic review request/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "synthetic-package.zip" }),
  ).toBeVisible();
  await capture(page, "reviews");
  await page.getByRole("tab", { name: /Findings|발견/ }).click();
  await page.getByLabel(/Search query|검색어/).fill("second");
  await expect(page).toHaveURL(/q=second/);
  const row = page.getByRole("link", { name: "CVE-2026-1234 second" });
  await expect(row).toHaveAttribute("href", /occurrence=1/);
  await row.click();
  await expect(page).toHaveURL(/finding=synthetic-finding&occurrence=1/);
  await page.goBack();
  await expect(page.getByLabel(/Search query|검색어/)).toHaveValue("second");
  await page.getByLabel(/Search query|검색어/).fill("no-matching-source");
  await expect(page.getByText(/No results|검색 결과가 없습니다/)).toBeVisible();
  await capture(page, "empty");
});
test("scope, preparing, errors, retry and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await capture(page, "mobile");
  await page.getByLabel(/Search scope|검색 범위/).selectOption("all");
  await expect(page.getByText(/Search preparation|검색 준비 중/)).toBeVisible();
  await capture(page, "preparing");
  await page.route("**/api/search?**", (route) =>
    route.fulfill({ status: 503, json: { detail: "unavailable" } }),
  );
  await page.getByLabel(/Search query|검색어/).fill("retry");
  await expect(page.getByRole("alert")).toContainText(
    /Search failed|검색 실패/,
  );
  await capture(page, "error");
  await page.unroute("**/api/search?**");
  await page.getByRole("button", { name: /Retry|다시 시도/ }).click();
  await expect(page.getByText(/Search preparation|검색 준비 중/)).toBeVisible();
  await expect(page.getByLabel(/Search query|검색어/)).toHaveValue("retry");
});
test("shortcut ignores inputs and IME, discards stale requests", async ({
  page,
}) => {
  await open(page);
  const input = page.getByLabel(/Search query|검색어/);
  await input.focus();
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  await input.dispatchEvent("keydown", {
    key: "k",
    ctrlKey: true,
    isComposing: true,
  });
  await expect(input).toBeFocused();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/search?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "obsolete") {
      await gate;
      await route
        .fulfill({
          json: {
            items: [
              {
                kind: "findings",
                id: "stale",
                label: "Obsolete result",
                safe_snippet: "",
                href: "/jobs/stale",
              },
            ],
            next_cursor: null,
            total: 1,
            index_complete: true,
          },
        })
        .catch(() => {});
    } else await route.continue();
  });
  await input.fill("obsolete");
  await page.waitForRequest((r) => r.url().includes("q=obsolete"));
  await input.fill("second");
  await expect(
    page.getByRole("link", { name: "CVE-2026-1234 second" }),
  ).toBeVisible();
  release();
  await expect(page.getByText("Obsolete result")).toHaveCount(0);
  await capture(page, "current-result");
  await page.locator("main").focus();
  await page.keyboard.press("Control+k");
  await expect(page).toHaveURL(fixture.origin + "/search");
  await expect(page.getByLabel(/Search query|검색어/)).toHaveValue("");
});

test("current denied scope and flag-off entry", async ({
  page,
  context,
  browser,
}) => {
  await context.addCookies([
    { name: "oidc_test_account", value: "bob", url: fixture.origin },
  ]);
  await open(page, "q=CVE-2026&type=findings&scope=all");
  await expect(page.getByRole("alert")).toContainText(/access|권한/);
  await capture(page, "denied");
  const disabled = await startOidcFixture();
  const disabledContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const other = await disabledContext.newPage();
    await other.goto(disabled.origin + "/search?q=synthetic");
    await other.getByRole("link", { name: /SSO/ }).click();
    await expect(other.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(other.getByRole("link", { name: /Cmd\/Ctrl/ })).toHaveCount(0);
  } finally {
    await disabledContext.close();
    await disabled.stop();
  }
});
