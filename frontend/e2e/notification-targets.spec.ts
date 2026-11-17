import { test, expect, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
test.use({ ignoreHTTPSErrors: true });
let fixture: Awaited<ReturnType<typeof startOidcFixture>>;
test.beforeAll(async () => {
  fixture = await startOidcFixture({ notificationTargets: true });
});
test.afterAll(async () => {
  await fixture.stop();
});
async function open(page: Page, path = "/notifications") {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto(fixture.origin + path);
  await page.getByRole("link", { name: /SSO/ }).click();
  await expect(page.locator("main")).toBeVisible();
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  if ((page.viewportSize()?.width || 1440) <= 800) {
    const sidebar = page.locator(".sidebar");
    if ((await sidebar.getAttribute("class"))?.split(" ").includes("open")) {
      await page.getByRole("button", { name: /^(Menu|메뉴)$/ }).click();
    }
    await expect
      .poll(() =>
        sidebar.evaluate((element) => element.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement)?.blur();
  });
  const dir = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-d1",
  );
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name + ".png"), fullPage: true });
}
test("mixed resources, current states, categories and authorized destinations", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByText("API key expires within 1 day", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Exception expired", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("API key · Revoked")).toBeVisible();
  await capture(page, "mixed-desktop-dark");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await capture(page, "mixed-desktop-light");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "mixed-mobile-light");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await capture(page, "mixed-mobile-dark");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("combobox", { name: "Notification type" })
    .selectOption("credentials");
  await expect(
    page.getByText("Exception expired", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link").filter({ hasText: "Build integration" }).click();
  await expect(page).toHaveURL(/api-keys\?key=d1-key$/);
  await expect(page.locator('[aria-current="true"]')).toContainText(
    "Build integration",
  );
  await expect(page.getByText("Selected API key")).toBeVisible();
  await capture(page, "key-selected");
  await page.goto(
    fixture.origin + "/admin?tab=allowlist&exception=d1-exception",
  );
  await expect(page.getByText("Selected exception")).toBeVisible();
  await expect(page.locator('[aria-current="true"]')).toContainText(
    "synthetic-policy.zip",
  );
  await capture(page, "exception-selected");
  await page.goto(fixture.origin + "/notifications?view=settings");
  await expect(page.getByText("API key expiry", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Exception expiry", { exact: true }),
  ).toBeVisible();
});
test("invalid and foreign selections keep ordinary authorized lists", async ({
  page,
}) => {
  await open(page, "/api-keys?key=missing");
  await expect(
    page.getByText("The selected API key was not found."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Build integration" }),
  ).toBeVisible();
  await capture(page, "key-not-found");
  await page.goto(fixture.origin + "/api-keys?key=d1-key&key=d1-revoked");
  await expect(
    page.getByText("The selected API key was not found."),
  ).toBeVisible();
  await expect(page.getByText("Selected API key", { exact: true })).toHaveCount(
    0,
  );
  await page.goto(fixture.origin + "/admin?tab=allowlist&exception=missing");
  await expect(
    page.getByText("The selected exception was not found."),
  ).toBeVisible();
  await expect(page.getByText("synthetic-policy.zip")).toBeVisible();
});
test("read errors, retry and Korean status labels", async ({ page }) => {
  await open(page);
  await expect(
    page.getByText("Exception expired", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/notifications?**", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic service unavailable" },
    }),
  );
  await page
    .getByRole("combobox", { name: "Notification type" })
    .selectOption("exceptions");
  await expect(page.getByRole("alert")).toBeVisible();
  await capture(page, "inbox-error");
  await page.unroute("**/api/notifications?**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Exception expired", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Account menu: alice" }).click();
  await page.getByRole("menuitem", { name: "Display settings" }).hover();
  await page.getByRole("menuitem", { name: "한국어" }).click();
  await expect(page.getByText("예외 · 만료됨")).toBeVisible();
  await capture(page, "mixed-korean");
});
test("account switch clears selected private resources and inbox", async ({
  page,
  context,
}) => {
  await open(page, "/api-keys?key=d1-key");
  await expect(page.getByText("Selected API key")).toBeVisible();
  await context.clearCookies();
  await context.addCookies([
    { name: "oidc_test_account", value: "bob", url: fixture.origin },
  ]);
  await page.goto(fixture.origin + "/api-keys?key=d1-key");
  await expect(page.getByRole("link", { name: /SSO/ })).toBeVisible();
  await expect(page.getByText("Build integration")).toHaveCount(0);
  await page.getByRole("link", { name: /SSO/ }).click();
  await expect(
    page.getByText("The selected API key was not found."),
  ).toBeVisible();
  await expect(page.getByText("Build integration")).toHaveCount(0);
  await page.goto(fixture.origin + "/notifications");
  await expect(
    page.getByText("No notifications yet", { exact: true }),
  ).toBeVisible();
  await capture(page, "empty-other-account");
  await page.goto(
    fixture.origin + "/admin?tab=allowlist&exception=d1-exception",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "403" }),
  ).toBeVisible();
  await expect(page.getByText("synthetic-policy.zip")).toHaveCount(0);
});
