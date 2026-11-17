import { test, expect, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
test.use({ ignoreHTTPSErrors: true });
type Mode =
  | "success"
  | "failed"
  | "delayed"
  | "disabled"
  | "waiting"
  | "unconfigured";
async function open(page: Page, origin: string) {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto(origin + "/admin");
  await page.getByRole("link", { name: /SSO/ }).click();
  await expect(
    page.getByRole("heading", { name: "Expiration reminders", exact: true }),
  ).toBeVisible();
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  if ((page.viewportSize()?.width || 1440) <= 800) {
    await expect
      .poll(() =>
        page
          .locator(".sidebar")
          .evaluate((e) => e.getBoundingClientRect().right),
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
    "../../docs/engineering/screenshots/convenience-d2",
  );
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name + ".png"), fullPage: true });
}
test("actual detection, safe aggregates, layouts and Korean", async ({
  page,
}) => {
  const fixture = await startOidcFixture({ expirationReminders: "success" });
  try {
    await open(page, fixture.origin);
    const panel = page.getByRole("region", { name: "Expiration reminders" });
    await expect(panel.getByText("Healthy", { exact: true })).toBeVisible();
    await expect(
      panel.getByText("Stored in app", { exact: true }),
    ).toBeVisible();
    await expect(panel).not.toContainText("Build integration");
    await expect(panel).not.toContainText("private");
    await capture(page, "success-desktop-dark");
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await capture(page, "success-desktop-light");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "success-mobile-light");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(fixture.origin + "/notifications");
    await expect(
      page.getByText("API key expires within 1 day", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Exception expired", { exact: true }),
    ).toBeVisible();
    await capture(page, "expiration-inbox");
    await page.goto(fixture.origin + "/admin");
    await page.getByRole("button", { name: "Account menu: alice" }).click();
    await page.getByRole("menuitem", { name: "Display settings" }).hover();
    await page.getByRole("menuitem", { name: "한국어" }).click();
    await expect(
      page.getByRole("heading", { name: "만료 알림" }),
    ).toBeVisible();
    await expect(page.getByText("앱 내 저장", { exact: true })).toBeVisible();
    await capture(page, "success-korean");
  } finally {
    await fixture.stop();
  }
});
for (const [mode, label] of [
  ["failed", "Failed"],
  ["delayed", "Delayed"],
  ["disabled", "Disabled"],
  ["waiting", "Waiting for first success"],
  ["unconfigured", "Activation time required"],
] as [Mode, string][]) {
  test("operational " + mode, async ({ page }) => {
    const fixture = await startOidcFixture({ expirationReminders: mode });
    try {
      await open(page, fixture.origin);
      const panel = page.getByRole("region", { name: "Expiration reminders" });
      await expect(panel.getByRole("status")).toHaveText(label);
      if (mode === "waiting" || mode === "unconfigured") {
        await expect(
          panel.getByText("No runs recorded.", { exact: true }),
        ).toBeVisible();
      }
      if (mode !== "unconfigured") await capture(page, mode);
      if (mode === "disabled") {
        await page.goto(fixture.origin + "/notifications");
        await expect(
          page.getByText("API key expires within 1 day", { exact: true }),
        ).toBeVisible();
      }
    } finally {
      await fixture.stop();
    }
  });
}
test("status read failure has explicit retry", async ({ page }) => {
  const fixture = await startOidcFixture({ expirationReminders: "success" });
  try {
    await open(page, fixture.origin);
    await page.route("**/api/admin/status", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"detail":"Status temporarily unavailable"}',
      }),
    );
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      "Status temporarily unavailable",
    );
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
    await capture(page, "status-error");
    await page.unroute("**/api/admin/status");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Expiration reminders", exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.stop();
  }
});
