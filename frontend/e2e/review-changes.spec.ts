import { expect, test, type Browser, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test.setTimeout(90000);

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
    "../../docs/engineering/screenshots/convenience-c2",
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

async function requestReview(owner: Page, origin: string) {
  const response = await owner.request.post(
    origin + "/api/scans/a1-synthetic-job/review",
    {
      headers: { Origin: origin, "X-AAG-Account": "a1-alice" },
      data: { reason: "Synthetic C2 evidence request" },
    },
  );
  expect(response.status()).toBe(201);
  return response.json();
}
test("request changes, respond, preferences, withdrawal and immutable scan evidence", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice");
  const reviewer = await login(browser, fixture.origin, "bob");
  try {
    const r = await requestReview(owner.page, fixture.origin);
    const before = await (
      await owner.page.request.get(
        fixture.origin + "/api/scans/a1-synthetic-job",
      )
    ).json();
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await reviewer.page
      .getByRole("button", { name: "Claim review", exact: true })
      .click();
    await expect(
      reviewer.page.getByText("Assignee: bob", { exact: true }),
    ).toBeVisible();
    await expect(
      reviewer.page.getByRole("button", {
        name: "Request changes",
        exact: true,
      }),
    ).toBeVisible();
    await reviewer.page
      .getByRole("button", { name: "Request changes", exact: true })
      .click();
    await reviewer.page
      .getByLabel("Supplement request reason", { exact: true })
      .fill("Explain the access boundary in this result");
    await captureModes(reviewer.page, "request-changes");
    await reviewer.page
      .getByRole("button", { name: "Confirm supplement request" })
      .click();
    await expect(
      reviewer.page.getByRole("button", { name: "Save decision" }),
    ).not.toBeVisible();
    await owner.page.goto(fixture.origin + "/reviews/" + r.id);
    await expect(
      owner.page.getByText("Explain the access boundary in this result", {
        exact: true,
      }),
    ).toBeVisible();
    await owner.page
      .getByRole("button", { name: "Add explanation", exact: true })
      .click();
    await owner.page
      .getByLabel("Supplementary explanation", { exact: true })
      .fill("This explanation applies only to the scanned result");
    await captureModes(owner.page, "changes-requested");
    await owner.page.getByRole("button", { name: "Send explanation" }).click();
    await expect(
      owner.page.getByRole("button", { name: "Add explanation", exact: true }),
    ).not.toBeVisible();
    await owner.page
      .getByRole("button", { name: "Withdraw request", exact: true })
      .click();
    await owner.page
      .getByLabel("Withdrawal reason", { exact: true })
      .fill("This pending review is no longer needed");
    await captureModes(owner.page, "withdraw-confirm");
    await owner.page
      .getByRole("button", { name: "Confirm withdrawal" })
      .click();
    await expect(
      owner.page.getByText("Withdrawn", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      owner.page.getByRole("button", { name: "Withdraw request", exact: true }),
    ).not.toBeVisible();
    await captureModes(owner.page, "withdrawn");
    const after = await (
      await owner.page.request.get(
        fixture.origin + "/api/scans/a1-synthetic-job",
      )
    ).json();
    for (const key of [
      "verdict",
      "effective_verdict",
      "result",
      "content_hash",
    ])
      expect(after[key]).toEqual(before[key]);
    await reviewer.page.goto(fixture.origin + "/notifications");
    await expect(
      reviewer.page.getByText("Review withdrawn", { exact: true }),
    ).toBeVisible();
    await expect(
      reviewer.page.getByText("Explanation added", { exact: true }),
    ).toBeVisible();
    await captureModes(reviewer.page, "notifications");
    await reviewer.page.goto(fixture.origin + "/notifications?view=settings");
    await expect(
      reviewer.page.getByRole("checkbox", { name: /Review updates/ }),
    ).toBeChecked();
    await reviewer.page
      .getByRole("checkbox", { name: /Review updates/ })
      .uncheck();
    await reviewer.page
      .getByRole("button", { name: "Save notification settings" })
      .click();
    await expect(
      reviewer.page.getByText("Notification settings saved."),
    ).toBeVisible();
    await reviewer.page.reload();
    await expect(
      reviewer.page.getByRole("checkbox", { name: /Review updates/ }),
    ).not.toBeChecked();
    await captureModes(reviewer.page, "review-preferences");
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});

test("409 retains the supplement draft read-only after concurrent withdrawal", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice"),
    reviewer = await login(browser, fixture.origin, "bob");
  try {
    const r = await requestReview(owner.page, fixture.origin);
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await reviewer.page
      .getByRole("button", { name: "Claim review", exact: true })
      .click();
    await reviewer.page
      .getByRole("button", { name: "Request changes", exact: true })
      .click();
    await reviewer.page
      .getByLabel("Supplement request reason", { exact: true })
      .fill("Preserve the pending supplementary request");
    await reviewer.page.route(
      "**/api/reviews/" + r.id + "/request-changes",
      async (route) => {
        expect(route.request().headers()["x-aag-account"]).toBe("a1-bob");
        expect(route.request().postDataJSON().expected_revision).toBe(2);
        const result = await owner.page.request.post(
          fixture.origin + "/api/reviews/" + r.id + "/withdraw",
          {
            headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
            data: {
              expected_revision: 2,
              reason: "Concurrent requester withdrawal",
            },
          },
        );
        expect(result.status()).toBe(200);
        await route.continue();
      },
      { times: 1 },
    );
    await reviewer.page
      .getByRole("button", { name: "Confirm supplement request" })
      .click();
    await expect(reviewer.page.getByLabel("Read-only draft")).toContainText(
      "Preserve the pending supplementary request",
    );
    await expect(
      reviewer.page.getByText("Withdrawn", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      reviewer.page.getByRole("button", {
        name: "Re-edit draft against latest",
      }),
    ).not.toBeVisible();
    await captureModes(reviewer.page, "closed-conflict");
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});

test("uncertain accepted response needs one latest check and explicit re-edit on a new revision", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice"),
    reviewer = await login(browser, fixture.origin, "bob");
  try {
    const r = await requestReview(owner.page, fixture.origin);
    const post = async (
      actor: Page,
      account: string,
      action: string,
      revision: number,
    ) =>
      actor.request.post(
        fixture.origin + "/api/reviews/" + r.id + "/" + action,
        {
          headers: { Origin: fixture.origin, "X-AAG-Account": account },
          data: {
            expected_revision: revision,
            ...(action === "claim"
              ? {}
              : { reason: "Synthetic evidence explanation" }),
          },
        },
      );
    expect((await post(reviewer.page, "a1-bob", "claim", 1)).status()).toBe(
      200,
    );
    expect(
      (await post(reviewer.page, "a1-bob", "request-changes", 2)).status(),
    ).toBe(200);
    await owner.page.goto(fixture.origin + "/reviews/" + r.id);
    await owner.page
      .getByRole("button", { name: "Add explanation", exact: true })
      .click();
    await owner.page
      .getByLabel("Supplementary explanation", { exact: true })
      .fill("Retain this uncertain explanation");
    await owner.page.route(
      "**/api/reviews/" + r.id + "/respond",
      async (route) => {
        const result = await route.fetch();
        expect(result.status()).toBe(200);
        await route.fulfill({
          status: 503,
          json: { detail: "Synthetic uncertain response" },
        });
      },
      { times: 1 },
    );
    await owner.page.getByRole("button", { name: "Send explanation" }).click();
    await expect(
      owner.page.getByRole("button", {
        name: "Check latest review",
        exact: true,
      }),
    ).toBeVisible();
    await captureModes(owner.page, "uncertain-response");
    await owner.page
      .getByRole("button", { name: "Check latest review", exact: true })
      .click();
    await expect(
      owner.page.getByRole("button", {
        name: "Check latest review",
        exact: true,
      }),
    ).not.toBeVisible();
    await expect(owner.page.getByLabel("Read-only draft")).toContainText(
      "Retain this uncertain explanation",
    );
    expect(
      (await post(reviewer.page, "a1-bob", "request-changes", 4)).status(),
    ).toBe(200);
    await owner.page
      .getByRole("button", { name: "Reload review", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "Re-edit draft against latest" })
      .click();
    await owner.page.getByRole("button", { name: "Send explanation" }).click();
    await expect(
      owner.page.getByRole("button", { name: "Add explanation", exact: true }),
    ).not.toBeVisible();
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});

test("supplement form keeps input and focus across retryable reads, flushes drafts on qualification loss", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice"),
    reviewer = await login(browser, fixture.origin, "bob");
  try {
    const r = await requestReview(owner.page, fixture.origin);
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await reviewer.page
      .getByRole("button", { name: "Claim review", exact: true })
      .click();
    await reviewer.page
      .getByRole("button", { name: "Request changes", exact: true })
      .click();
    const reason = reviewer.page.getByLabel("Supplement request reason", {
      exact: true,
    });
    await reason.fill(
      "Keep this explanation request through temporary read failure",
    );
    await reviewer.page.route(
      "**/api/reviews/" + r.id,
      (route) =>
        route.fulfill({
          status: 503,
          json: { detail: "Synthetic temporary read failure" },
        }),
      { times: 1 },
    );
    await reviewer.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reviews/" + r.id) &&
        response.status() === 503,
    );
    await expect(reason).toBeFocused();
    await expect(reason).toHaveValue(
      "Keep this explanation request through temporary read failure",
    );
    await captureModes(reviewer.page, "read-error");
    await reviewer.page
      .getByLabel("Comment", { exact: true })
      .fill("Retain co-located comment before permission refresh");
    const changed = await owner.page.request.patch(
      fixture.origin + "/api/admin/users/a1-bob",
      {
        headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
        data: { role: "admin", reviewer: false, active: true },
      },
    );
    expect(changed.status()).toBe(200);
    await reviewer.page
      .getByRole("button", { name: "Confirm supplement request" })
      .click();
    await expect(reviewer.page.getByLabel("Read-only draft")).toContainText(
      "Keep this explanation request",
    );
    await expect(
      reviewer.page.getByRole("button", {
        name: "Request changes",
        exact: true,
      }),
    ).not.toBeVisible();
    expect(
      await reviewer.page.evaluate(() =>
        Object.entries(sessionStorage)
          .filter(([key]) => key.startsWith("aag-draft:"))
          .map(([, v]) => v)
          .join("\n"),
      ),
    ).toContain("Retain co-located comment");
    await captureModes(reviewer.page, "qualification-lost");
    await reviewer.page
      .getByRole("button", { name: "Account menu: bob" })
      .click();
    await reviewer.page
      .getByRole("menuitem", { name: "Display settings" })
      .hover();
    await reviewer.page.getByRole("menuitem", { name: "한국어" }).click();
    await expect(reviewer.page.getByLabel("읽기 전용 초안")).toBeVisible();
    await capture(reviewer.page, "qualification-lost-desktop-ko-dark");
  } finally {
    await owner.context.close();
    await reviewer.context.close();
    await fixture.stop();
  }
});
