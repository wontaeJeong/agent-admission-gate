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
    "../../docs/engineering/screenshots/convenience-c3",
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

async function requestReview(owner: Page, origin: string, jobId: string) {
  const response = await owner.request.post(
    origin + "/api/scans/" + jobId + "/review",
    {
      headers: { Origin: origin, "X-AAG-Account": "a1-alice" },
      data: { reason: "Synthetic C3 evidence request" },
    },
  );
  expect(response.status()).toBe(201);
  return response.json();
}

const zip = Buffer.from(
  "UEsDBBQAAAAAADBtYVsAAAAAAAAAAAAAAAAJAAAAcmVhZG1lLm1kUEsBAhQDFAAAAAAAMG1hWwAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS5tZFBLBQYAAAAAAQABADcAAAAnAAAAAAA=",
  "base64",
);
const correctedZip = Buffer.from(
  "UEsDBBQAAAAAAEaBcV25HRtQIQAAACEAAAAJAAAAcmVhZG1lLm1kQ29ycmVjdGVkIHN0YXRpYyBzb3VyY2UgcGFja2FnZS4KUEsBAhQDFAAAAAAARoFxXbkdG1AhAAAAIQAAAAkAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS5tZFBLBQYAAAAAAQABADcAAABIAAAAAAA=",
  "base64",
);
async function upload(owner: Page, origin: string, from?: string) {
  const response = await owner.request.post(origin + "/api/scans/upload", {
    headers: { Origin: origin, "X-AAG-Account": "a1-alice" },
    multipart: {
      file: {
        name: "source.zip",
        mimeType: "application/zip",
        buffer: from ? correctedZip : zip,
      },
      ...(from ? { origin_job_id: from } : {}),
    },
  });
  expect(response.status()).toBe(202);
  const job = await response.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await owner.request.get(origin + "/api/scans/" + job.id)
          ).json()
        ).status,
    )
    .toBe("COMPLETED");
  return job;
}
test("corrected ZIP creates an independent follow-up with two-way content links", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice");
  const reviewer = await login(browser, fixture.origin, "bob");
  try {
    const old = await upload(owner.page, fixture.origin);
    const r = await requestReview(owner.page, fixture.origin, old.id);
    await reviewer.page.goto(fixture.origin + "/reviews/" + r.id);
    await expect(
      reviewer.page.getByLabel("Decision reason", { exact: true }),
    ).toBeVisible();
    await reviewer.page
      .getByLabel("Decision reason", { exact: true })
      .fill("Submit corrected content for a fresh review");
    await reviewer.page.getByRole("button", { name: "Save decision" }).click();
    await owner.page.goto(fixture.origin + "/reviews/" + r.id);
    await expect(
      owner.page.getByRole("link", {
        name: "Scan corrected content",
        exact: true,
      }),
    ).toBeVisible();
    await captureModes(owner.page, "rejected-source");
    await owner.page
      .getByRole("link", { name: "Scan corrected content", exact: true })
      .click();
    await expect(owner.page).toHaveURL(
      fixture.origin + "/new?from=" + old.id + "&mode=latest",
    );
    await owner.page.locator("input[type=file]").setInputFiles({
      name: "corrected.zip",
      mimeType: "application/zip",
      buffer: correctedZip,
    });
    const submitted = owner.page.waitForResponse(
      (response) =>
        response.url() === fixture.origin + "/api/scans/upload" &&
        response.request().method() === "POST",
    );
    await owner.page
      .getByRole("button", { name: "Run scan", exact: true })
      .click();
    const job = await (await submitted).json();
    expect(job.origin_job_id).toBe(old.id);
    await expect(owner.page).toHaveURL(fixture.origin + "/jobs/" + job.id);
    await expect(
      owner.page.getByRole("button", {
        name: "Request follow-up review",
        exact: true,
      }),
    ).toBeVisible();
    await owner.page
      .getByRole("button", { name: "Request follow-up review", exact: true })
      .click();
    await owner.page
      .getByLabel("Follow-up reason", { exact: true })
      .fill("Corrected source requires an independent review");
    await captureModes(owner.page, "followup-form");
    const created = owner.page.waitForResponse(
      (response) =>
        response.url().endsWith("/follow-ups") &&
        response.request().method() === "POST",
    );
    await owner.page
      .getByRole("button", { name: "Submit follow-up request", exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(201);
    const next = await response.json();
    const savedJob = await (
      await owner.page.request.get(fixture.origin + "/api/scans/" + job.id)
    ).json();
    expect(savedJob.content_hash).not.toBe(
      (
        await (
          await owner.page.request.get(fixture.origin + "/api/scans/" + old.id)
        ).json()
      ).content_hash,
    );
    await expect(owner.page).toHaveURL(fixture.origin + "/reviews/" + next.id);
    await expect(
      owner.page.getByRole("link", { name: "Previous request", exact: true }),
    ).toHaveAttribute("href", "/reviews/" + r.id);
    await expect(
      owner.page.getByText("Assignee: Unassigned", { exact: true }),
    ).toBeVisible();
    await expect(
      owner.page.getByText("Current content hash:", { exact: false }),
    ).toBeVisible();
    await captureModes(owner.page, "new-request");
    await owner.page
      .getByRole("link", { name: "Previous request", exact: true })
      .click();
    await expect(
      owner.page.getByRole("link", { name: "Follow-up request", exact: true }),
    ).toHaveAttribute("href", "/reviews/" + next.id);
    await expect(
      owner.page
        .getByText("Submit corrected content for a fresh review", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await captureModes(owner.page, "rejected-linked");
  } finally {
    await owner.context.close().catch(() => {});
    await reviewer.context.close().catch(() => {});
    await fixture.stop();
  }
});

async function supplementarySource(
  owner: Page,
  reviewer: Page,
  origin: string,
) {
  const old = await upload(owner, origin);
  const r = await requestReview(owner, origin, old.id);
  for (const [action, revision] of [
    ["claim", 1],
    ["request-changes", 2],
  ] as const) {
    const response = await reviewer.request.post(
      origin + "/api/reviews/" + r.id + "/" + action,
      {
        headers: { Origin: origin, "X-AAG-Account": "a1-bob" },
        data: {
          expected_revision: revision,
          ...(action === "claim"
            ? {}
            : { reason: "Scan a corrected source package" }),
        },
      },
    );
    expect(response.status()).toBe(200);
  }
  const corrected = await upload(owner, origin, old.id);
  return { old, r, corrected };
}

test("changes requested keeps explanation separate and supersedes only on follow-up creation", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice");
  const reviewer = await login(browser, fixture.origin, "bob");
  try {
    const { old, r, corrected } = await supplementarySource(
      owner.page,
      reviewer.page,
      fixture.origin,
    );
    const before = await (
      await owner.page.request.get(fixture.origin + "/api/scans/" + old.id)
    ).json();
    await owner.page.goto(fixture.origin + "/reviews/" + r.id);
    await expect(
      owner.page.getByRole("button", { name: "Add explanation", exact: true }),
    ).toBeVisible();
    await expect(
      owner.page.getByRole("link", {
        name: "Scan corrected content",
        exact: true,
      }),
    ).toBeVisible();
    await captureModes(owner.page, "changes-requested");
    await owner.page.goto(fixture.origin + "/jobs/" + corrected.id);
    await owner.page
      .getByRole("button", { name: "Request follow-up review", exact: true })
      .click();
    await owner.page
      .getByLabel("Follow-up reason", { exact: true })
      .fill("Corrected package supplied for a new decision");
    await owner.page
      .getByRole("button", { name: "Submit follow-up request", exact: true })
      .click();
    await expect(owner.page).toHaveURL(/\/reviews\/[a-f0-9]+$/);
    await owner.page
      .getByRole("link", { name: "Previous request", exact: true })
      .click();
    await expect(
      owner.page.getByText("Superseded by a follow-up request", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      owner.page.getByRole("button", { name: "Add explanation", exact: true }),
    ).not.toBeVisible();
    await captureModes(owner.page, "superseded-source");
    const after = await (
      await owner.page.request.get(fixture.origin + "/api/scans/" + old.id)
    ).json();
    for (const key of [
      "verdict",
      "effective_verdict",
      "result",
      "content_hash",
    ])
      expect(after[key]).toEqual(before[key]);
    await owner.page
      .getByRole("button", { name: "Account menu: alice" })
      .click();
    await owner.page
      .getByRole("menuitem", { name: "Display settings" })
      .hover();
    await owner.page.getByRole("menuitem", { name: "한국어" }).click();
    await expect(
      owner.page.getByText("수정 후 요청으로 대체됨", { exact: true }),
    ).toBeVisible();
    await capture(owner.page, "superseded-desktop-ko-dark");
  } finally {
    await owner.context.close().catch(() => {});
    await reviewer.context.close().catch(() => {});
    await fixture.stop();
  }
});

test("duplicate 409 retains reason read-only and links to the authorized winning follow-up", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice");
  const reviewer = await login(browser, fixture.origin, "bob");
  try {
    const { r, corrected } = await supplementarySource(
      owner.page,
      reviewer.page,
      fixture.origin,
    );
    await owner.page.goto(fixture.origin + "/jobs/" + corrected.id);
    await owner.page
      .getByRole("button", { name: "Request follow-up review", exact: true })
      .click();
    await owner.page
      .getByLabel("Follow-up reason", { exact: true })
      .fill("Keep the losing follow-up reason");
    let winner = "";
    await owner.page.route(
      "**/api/reviews/" + r.id + "/follow-ups",
      async (route) => {
        expect(route.request().headers()["x-aag-account"]).toBe("a1-alice");
        expect(route.request().postDataJSON()).toEqual({
          expected_revision: 3,
          new_job_id: corrected.id,
          reason: "Keep the losing follow-up reason",
        });
        const created = await owner.page.request.post(
          fixture.origin + "/api/reviews/" + r.id + "/follow-ups",
          {
            headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
            data: {
              expected_revision: 3,
              new_job_id: corrected.id,
              reason: "Concurrent accepted request",
            },
          },
        );
        expect(created.status()).toBe(201);
        winner = (await created.json()).id;
        await route.continue();
      },
      { times: 1 },
    );
    await owner.page
      .getByRole("button", { name: "Submit follow-up request", exact: true })
      .click();
    await expect(owner.page.getByLabel("Read-only draft")).toContainText(
      "Keep the losing follow-up reason",
    );
    await expect(
      owner.page.getByRole("link", {
        name: "View existing follow-up request",
        exact: true,
      }),
    ).toHaveAttribute("href", "/reviews/" + winner);
    await expect(
      owner.page.getByRole("button", { name: "Re-edit draft against latest" }),
    ).not.toBeVisible();
    await expect(owner.page.getByRole("alert")).toContainText(
      "already has a follow-up",
    );
    await captureModes(owner.page, "duplicate-conflict");
  } finally {
    await owner.context.close().catch(() => {});
    await reviewer.context.close().catch(() => {});
    await fixture.stop();
  }
});

test("accepted but lost response settles with one GET and preserves the reason", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice");
  const reviewer = await login(browser, fixture.origin, "bob");
  try {
    const { r, corrected } = await supplementarySource(
      owner.page,
      reviewer.page,
      fixture.origin,
    );
    await owner.page.goto(fixture.origin + "/jobs/" + corrected.id);
    await owner.page
      .getByRole("button", { name: "Request follow-up review", exact: true })
      .click();
    const reason = owner.page.getByLabel("Follow-up reason", { exact: true });
    await reason.fill("Preserve this submitted follow-up explanation");
    await owner.page.route(
      "**/api/reviews/" + r.id,
      (route) =>
        route.fulfill({
          status: 503,
          json: { detail: "Synthetic read interruption" },
        }),
      { times: 1 },
    );
    await owner.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reviews/" + r.id) &&
        response.status() === 503,
    );
    await expect(reason).toBeFocused();
    await expect(reason).toHaveValue(
      "Preserve this submitted follow-up explanation",
    );
    await captureModes(owner.page, "read-error");
    await owner.page.route(
      "**/api/reviews/" + r.id + "/follow-ups",
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.fulfill({
          status: 503,
          json: { detail: "Synthetic lost response" },
        });
      },
      { times: 1 },
    );
    await owner.page
      .getByRole("button", { name: "Submit follow-up request", exact: true })
      .click();
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
    await expect(
      owner.page.getByRole("link", {
        name: "View existing follow-up request",
        exact: true,
      }),
    ).toBeVisible();
    await expect(owner.page.getByLabel("Read-only draft")).toContainText(
      "Preserve this submitted follow-up explanation",
    );
    await expect(owner.page).toHaveURL(
      fixture.origin + "/jobs/" + corrected.id,
    );
  } finally {
    await owner.context.close().catch(() => {});
    await reviewer.context.close().catch(() => {});
    await fixture.stop();
  }
});

test("403 flushes co-located reasons before session recheck and requires explicit recovery", async ({
  browser,
}) => {
  const fixture = await startOidcFixture({ reviewWorkflow: true });
  const owner = await login(browser, fixture.origin, "alice");
  const reviewer = await login(browser, fixture.origin, "bob");
  try {
    const { r, corrected } = await supplementarySource(
      owner.page,
      reviewer.page,
      fixture.origin,
    );
    await owner.page.goto(fixture.origin + "/jobs/" + corrected.id);
    await owner.page
      .getByRole("button", { name: "Request follow-up review", exact: true })
      .click();
    await owner.page
      .getByLabel("Follow-up reason", { exact: true })
      .fill("Keep this follow-up after permission denial");
    await owner.page
      .getByLabel("Reason", { exact: true })
      .fill("Keep the separate co-located review reason");
    await owner.page.route(
      "**/api/reviews/" + r.id + "/follow-ups",
      (route) =>
        route.fulfill({
          status: 403,
          json: { detail: "Synthetic permission change" },
        }),
      { times: 1 },
    );
    await owner.page
      .getByRole("button", { name: "Submit follow-up request", exact: true })
      .click();
    await expect(
      owner.page.getByRole("button", {
        name: "Restore previous draft",
        exact: true,
      }),
    ).toHaveCount(2);
    const saved = await owner.page.evaluate(() =>
      Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith("aag-draft:"))
        .map(([, value]) => value)
        .join("\n"),
    );
    expect(saved).toContain("Keep this follow-up after permission denial");
    expect(
      (
        await (
          await owner.page.request.get(
            fixture.origin + "/api/scans/" + corrected.id,
          )
        ).json()
      ).review,
    ).toBeNull();
    expect(
      await owner.page.evaluate(() =>
        Object.entries(sessionStorage)
          .filter(([key]) => key.startsWith("aag-draft:"))
          .map(([, value]) => value)
          .join("\n"),
      ),
    ).toContain("Keep the separate co-located review reason");
    await captureModes(owner.page, "permission-denied");
  } finally {
    await owner.context.close().catch(() => {});
    await reviewer.context.close().catch(() => {});
    await fixture.stop();
  }
});
