import { expect, test, type Browser, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

async function login(browser: Browser, origin: string, account: string) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
  });
  await context.addCookies([
    { name: "oidc_test_account", value: account, url: origin },
  ]);
  await context.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  const page = await context.newPage();
  await page.goto(origin + "/jobs/a1-synthetic-job");
  await page.getByRole("link", { name: "Sign in with SSO" }).click();
  await expect(page).toHaveURL(origin + "/jobs/a1-synthetic-job");
  await expect(page.locator(".sidebar")).toBeVisible();
  return { page, context };
}
async function capture(page: Page, name: string) {
  if (!process.env.AAG_CAPTURE_EVIDENCE) return;
  const dir = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-c1",
  );
  mkdirSync(dir, { recursive: true });
  await page.locator("main").focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: resolve(dir, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
}

test("claim, release, decision and public activity use captured account and revision", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice");
  const reviewer = await login(browser, fixture.origin, "bob");
  try {
    const response = await owner.page.request.post(
      fixture.origin + "/api/scans/a1-synthetic-job/review",
      {
        headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
        data: { reason: "Synthetic C1 review request" },
      },
    );
    expect(response.status()).toBe(201);
    const r = await response.json();
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await expect(
      reviewer.page.getByRole("button", { name: "Claim review", exact: true }),
    ).toBeVisible();
    await capture(reviewer.page, "unassigned-desktop-dark");
    await reviewer.page
      .getByRole("button", { name: "Claim review", exact: true })
      .click();
    await expect(
      reviewer.page.getByText("Assignee: bob", { exact: true }),
    ).toBeVisible();
    await capture(reviewer.page, "claimed-desktop-dark");
    if (process.env.AAG_CAPTURE_EVIDENCE) {
      await reviewer.page
        .getByRole("button", { name: "Account menu: bob" })
        .click();
      await reviewer.page
        .getByRole("menuitem", { name: "Display settings" })
        .hover();
      await reviewer.page.getByRole("menuitem", { name: "한국어" }).click();
      await expect(
        reviewer.page.getByRole("heading", { name: "업무 이력" }),
      ).toBeVisible();
      await expect(
        reviewer.page.getByRole("button", { name: "담당 해제", exact: true }),
      ).toBeVisible();
      await capture(reviewer.page, "claimed-desktop-ko-dark");
      await reviewer.page
        .getByRole("button", { name: "계정 메뉴: bob" })
        .click();
      await reviewer.page.getByRole("menuitem", { name: "화면 설정" }).hover();
      await reviewer.page.getByRole("menuitem", { name: "English" }).click();
    }

    await reviewer.page
      .getByRole("button", { name: "Release assignment", exact: true })
      .click();
    await reviewer.page
      .getByLabel("Release reason")
      .fill("Reassign for second review");
    await reviewer.page
      .getByRole("button", { name: "Confirm release" })
      .click();
    await expect(
      reviewer.page.getByRole("button", { name: "Claim review", exact: true }),
    ).toBeVisible();
    await reviewer.page
      .getByRole("button", { name: "Claim review", exact: true })
      .click();
    await expect(
      reviewer.page.getByText("Assignee: bob", { exact: true }),
    ).toBeVisible();
    await reviewer.page
      .getByLabel("Decision reason", { exact: true })
      .fill("Evidence checked in synthetic review");
    await reviewer.page.getByRole("button", { name: "Save decision" }).click();
    await expect(
      reviewer.page.getByRole("button", { name: "Save decision" }),
    ).not.toBeVisible();
    await owner.page.goto(fixture.origin + "/reviews/" + r.id);
    await expect(
      owner.page.getByRole("heading", { name: "Workflow activity" }),
    ).toBeVisible();
    await expect(
      owner.page.getByText("Reassign for second review", { exact: true }),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});

async function captureModes(page: Page, name: string) {
  if (!process.env.AAG_CAPTURE_EVIDENCE) return;
  for (const [mode, width, height, label] of [
    ["dark", 1440, 1000, "desktop-dark"],
    ["light", 1440, 1000, "desktop-light"],
    ["dark", 390, 844, "mobile-dark"],
    ["light", 390, 844, "mobile-light"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      (mode) => (document.documentElement.dataset.theme = mode),
      mode,
    );
    if (width < 600)
      await expect
        .poll(() =>
          page
            .locator(".sidebar")
            .evaluate((element) => element.getBoundingClientRect().right),
        )
        .toBeLessThanOrEqual(0);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    await capture(page, name + "-" + label);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
}

test("409 preserves authored reason and requires explicit latest-revision recovery", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice"),
    reviewer = await login(browser, fixture.origin, "bob");
  try {
    const r = await (
      await owner.page.request.post(
        fixture.origin + "/api/scans/a1-synthetic-job/review",
        {
          headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
          data: { reason: "Synthetic conflict request" },
        },
      )
    ).json();
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await expect(
      reviewer.page.getByRole("button", { name: "Claim review", exact: true }),
    ).toBeVisible();
    await captureModes(reviewer.page, "unassigned");
    await reviewer.page
      .getByRole("button", { name: "Claim review", exact: true })
      .click();
    await expect(
      reviewer.page.getByText("Assignee: bob", { exact: true }),
    ).toBeVisible();
    await captureModes(reviewer.page, "claimed");
    await reviewer.page
      .getByLabel("Decision reason", { exact: true })
      .fill("Retain this authored reason after reassignment");
    await reviewer.page.route(
      "**/api/reviews/" + r.id + "/decision",
      async (route) => {
        const response = await owner.page.request.post(
          fixture.origin + "/api/reviews/" + r.id + "/release",
          {
            headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
            data: {
              expected_revision: 2,
              reason: "Concurrent operational reassignment",
            },
          },
        );
        expect(response.status()).toBe(200);
        expect(route.request().headers()["x-aag-account"]).toBe("a1-bob");
        expect(route.request().postDataJSON().expected_revision).toBe(2);
        await route.continue();
      },
      { times: 1 },
    );
    await reviewer.page.getByRole("button", { name: "Save decision" }).click();
    await expect(reviewer.page.getByLabel("Read-only draft")).toContainText(
      "Retain this authored reason",
    );
    const reload = reviewer.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reviews/" + r.id) &&
        response.request().method() === "GET",
    );
    await reviewer.page
      .getByRole("button", { name: "Reload review", exact: true })
      .click();
    expect((await reload).status()).toBe(200);
    await expect(reviewer.page.getByLabel("Read-only draft")).toContainText(
      "Retain this authored reason",
    );
    await captureModes(reviewer.page, "revision-conflict");
    await expect(
      reviewer.page.getByRole("button", {
        name: "Re-edit draft against latest",
      }),
    ).toBeVisible();
    await reviewer.page
      .getByRole("button", { name: "Re-edit draft against latest" })
      .click();
    await expect(
      reviewer.page.getByLabel("Decision reason", { exact: true }),
    ).toHaveValue("Retain this authored reason after reassignment");
    const submitted = reviewer.page.waitForRequest(
      (request) =>
        request.url().endsWith("/decision") && request.method() === "POST",
    );
    await reviewer.page.getByRole("button", { name: "Save decision" }).click();
    expect((await submitted).postDataJSON().expected_revision).toBe(3);
    await expect(
      reviewer.page.getByRole("button", { name: "Save decision" }),
    ).not.toBeVisible();
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});

test("qualification loss removes decision eligibility while preserving a read-only reason", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice"),
    reviewer = await login(browser, fixture.origin, "bob");
  try {
    const r = await (
      await owner.page.request.post(
        fixture.origin + "/api/scans/a1-synthetic-job/review",
        {
          headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
          data: { reason: "Synthetic role-loss request" },
        },
      )
    ).json();
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await reviewer.page
      .getByRole("button", { name: "Claim review", exact: true })
      .click();
    await expect(
      reviewer.page.getByText("Assignee: bob", { exact: true }),
    ).toBeVisible();
    await reviewer.page
      .getByLabel("Decision reason", { exact: true })
      .fill("Preserve reason after reviewer qualification loss");
    const changed = await owner.page.request.patch(
      fixture.origin + "/api/admin/users/a1-bob",
      {
        headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
        data: { role: "admin", reviewer: false, active: true },
      },
    );
    expect(changed.status()).toBe(200);
    await reviewer.page
      .getByLabel("Comment", { exact: true })
      .fill("Preserve co-located comment before qualification refresh");
    await reviewer.page.getByRole("button", { name: "Save decision" }).click();
    await expect(
      reviewer.page.getByRole("button", { name: "Save decision" }),
    ).not.toBeVisible();
    await expect(reviewer.page.getByLabel("Read-only draft")).toContainText(
      "Preserve reason",
    );
    expect(
      await reviewer.page.evaluate(() =>
        Object.entries(sessionStorage)
          .filter(([key]) => key.startsWith("aag-draft:"))
          .map(([, value]) => value)
          .join("\n"),
      ),
    ).toContain("Preserve co-located comment");
    await captureModes(reviewer.page, "qualification-lost");
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});

test("workflow filters, literal search, saved views and dashboard agree; errors and flag-off are explicit", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice"),
    reviewer = await login(browser, fixture.origin, "bob");
  try {
    const r = await (
      await owner.page.request.post(
        fixture.origin + "/api/scans/a1-synthetic-job/review",
        {
          headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
          data: { reason: "Synthetic queue request" },
        },
      )
    ).json();
    await reviewer.page.goto(fixture.origin + "/");
    await reviewer.page
      .getByRole("link", { name: /1 actionable reviews for me/ })
      .click();
    await expect(reviewer.page).toHaveURL(/tab=actionable/);
    await reviewer.page.getByLabel("Search reviews").pressSequentially("all");
    await expect(reviewer.page).toHaveURL(/q=all/);
    await expect(
      reviewer.page.getByText("No reviews in this queue.", { exact: true }),
    ).toBeVisible();
    await reviewer.page.setViewportSize({ width: 390, height: 844 });
    expect(
      await reviewer.page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    expect(
      await reviewer.page
        .locator(".panel")
        .first()
        .evaluate((element) => element.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(390);
    await reviewer.page.setViewportSize({ width: 1440, height: 1000 });
    await captureModes(reviewer.page, "empty-queue");
    await reviewer.page.getByLabel("Search reviews").fill("");
    await reviewer.page
      .getByLabel("Assignee", { exact: true })
      .selectOption("unassigned");
    await reviewer.page.getByLabel("Workflow stage").selectOption("waiting");
    await reviewer.page
      .getByLabel("Sort", { exact: true })
      .selectOption("oldest");
    await expect(
      reviewer.page.getByRole("link", {
        name: "synthetic-package.zip",
        exact: true,
      }),
    ).toBeVisible();
    await reviewer.page.getByLabel("View name").fill("Unassigned oldest");
    await reviewer.page
      .getByRole("button", { name: "Save current view", exact: true })
      .click();
    await expect(
      reviewer.page.getByRole("button", { name: "Apply · Unassigned oldest" }),
    ).toBeVisible();
    await reviewer.page
      .getByRole("link", { name: "synthetic-package.zip", exact: true })
      .click();
    await reviewer.page
      .getByRole("link", { name: "Reviews list", exact: true })
      .click();
    await expect(reviewer.page).toHaveURL(/assignee=unassigned/);
    await expect(reviewer.page).toHaveURL(/stage=waiting/);
    await expect(reviewer.page).toHaveURL(/sort=oldest/);
    await reviewer.page.route("**/api/reviews?**", (route) =>
      route.fulfill({
        status: 503,
        json: { detail: "Synthetic temporary queue failure" },
      }),
    );
    await reviewer.page.reload();
    await expect(
      reviewer.page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
    await captureModes(reviewer.page, "queue-error");
    await reviewer.page.unroute("**/api/reviews?**");
    await reviewer.page
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(
      reviewer.page.getByRole("link", {
        name: "synthetic-package.zip",
        exact: true,
      }),
    ).toBeVisible();
    await reviewer.page.route("**/api/auth/config", async (route) => {
      const result = await route.fetch();
      await route.fulfill({
        json: { ...(await result.json()), review_workflow_enabled: false },
      });
    });
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await expect(
      reviewer.page.getByRole("heading", { name: "Review details" }),
    ).toBeVisible();
    await expect(
      reviewer.page.getByRole("button", { name: "Claim review", exact: true }),
    ).not.toBeVisible();
    await expect(
      reviewer.page.getByRole("button", { name: "Save decision" }),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});

test("uncertain release keeps reason and requires a fresh explicit read before retry", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice"),
    reviewer = await login(browser, fixture.origin, "bob");
  try {
    const r = await (
      await owner.page.request.post(
        fixture.origin + "/api/scans/a1-synthetic-job/review",
        {
          headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
          data: { reason: "Synthetic uncertain release" },
        },
      )
    ).json();
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await reviewer.page
      .getByRole("button", { name: "Claim review", exact: true })
      .click();
    await expect(
      reviewer.page.getByText("Assignee: bob", { exact: true }),
    ).toBeVisible();
    await reviewer.page
      .getByRole("button", { name: "Release assignment", exact: true })
      .click();
    await reviewer.page
      .getByLabel("Release reason", { exact: true })
      .fill("Keep uncertain release reason");
    await reviewer.page.route(
      "**/api/reviews/" + r.id,
      (route) =>
        route.fulfill({
          status: 503,
          json: { detail: "Synthetic transient review read" },
        }),
      { times: 1 },
    );
    await reviewer.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reviews/" + r.id) &&
        response.status() === 503,
    );
    await expect(
      reviewer.page.getByLabel("Release reason", { exact: true }),
    ).toBeFocused();
    await expect(
      reviewer.page.getByLabel("Release reason", { exact: true }),
    ).toHaveValue("Keep uncertain release reason");

    await reviewer.page.route(
      "**/api/reviews/" + r.id + "/release",
      (route) =>
        route.fulfill({
          status: 503,
          json: { detail: "Synthetic unknown write outcome" },
        }),
      { times: 1 },
    );
    await reviewer.page
      .getByRole("button", { name: "Confirm release" })
      .click();
    await expect(
      reviewer.page.getByRole("button", { name: "Confirm release" }),
    ).toBeDisabled();
    await reviewer.page
      .getByRole("button", { name: "Check latest review", exact: true })
      .click();
    await expect(
      reviewer.page.getByLabel("Release reason", { exact: true }),
    ).toHaveValue("Keep uncertain release reason");
    await expect(
      reviewer.page.getByRole("button", { name: "Confirm release" }),
    ).toBeEnabled();
    await reviewer.page
      .getByRole("button", { name: "Confirm release" })
      .click();
    await expect(
      reviewer.page.getByRole("button", { name: "Claim review", exact: true }),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});
