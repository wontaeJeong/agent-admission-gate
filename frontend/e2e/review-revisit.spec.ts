import { expect, test, type Page } from "@playwright/test";

const job = {
  id: "sample-scan",
  owner_id: "requester",
  source: "synthetic-package.zip",
  source_type: "upload",
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
  result: { findings: [], engines: [], coverage_complete: true },
};

async function authenticate(page: Page, staff = false) {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({ json: { mode: "local", boards_enabled: false } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        id: staff ? "reviewer" : "requester",
        name: staff ? "Test reviewer" : "Test requester",
        role: "user",
        reviewer: staff,
      },
    }),
  );
}

test("owners can revisit pending, approved and rejected reviews after reload", async ({
  page,
}) => {
  await authenticate(page);
  let status = "pending";
  await page.route("**/api/scans/sample-scan", (route) =>
    route.fulfill({
      json: {
        ...job,
        effective_verdict:
          status === "approved"
            ? "ALLOW"
            : status === "rejected"
              ? "BLOCK"
              : "REVIEW",
        review: { id: "sample-review", status },
      },
    }),
  );
  await page.route("**/api/reviews/sample-review", (route) =>
    route.fulfill({
      json: {
        id: "sample-review",
        job_id: job.id,
        requester_id: "requester",
        reason: "Synthetic review context",
        status,
        reviewer_id: null,
        decision_reason: null,
        created_at: 1760000003,
        decided_at: null,
        job,
      },
    }),
  );
  await page.route("**/api/scans/sample-scan/comments", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/jobs/sample-scan");
  const panel = page.getByRole("region", { name: "Review request" });
  await expect(panel).toContainText("pending");
  await expect(
    page.getByRole("textbox", { name: "Reason", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: "View review details" }),
  ).toHaveAttribute("href", "/reviews/sample-review");
  await page.screenshot({
    path: "test-results/revisit-pending-desktop.png",
    fullPage: true,
  });
  status = "approved";
  await page.reload();
  await expect(panel).toContainText("approved");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const bounds = await page.locator(".sidebar").boundingBox();
      return bounds ? bounds.x + bounds.width : 0;
    })
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "test-results/revisit-approved-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  status = "rejected";
  await page.reload();
  await expect(panel).toContainText("rejected");
  await page.screenshot({
    path: "test-results/revisit-rejected-mobile.png",
    fullPage: true,
  });
  await panel.getByRole("link", { name: "View review details" }).click();
  await expect(page).toHaveURL(/\/reviews\/sample-review$/);
  await expect(
    page.getByRole("heading", { name: "Review details" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic review context")).toBeVisible();
});

test("request form handles unavailable status, submission errors and busy state", async ({
  page,
}) => {
  await authenticate(page);
  let summary: null | undefined = null;
  await page.route("**/api/scans/sample-scan", (route) =>
    route.fulfill({ json: summary === null ? { ...job, review: null } : job }),
  );
  let completeRequest: (() => void) | undefined;
  await page.route("**/api/scans/sample-scan/review", async (route) => {
    await new Promise<void>((resolve) => {
      completeRequest = resolve;
    });
    await route.fulfill({
      status: 503,
      json: { detail: "Review service unavailable" },
    });
  });
  await page.goto("/jobs/sample-scan");
  const reason = page.getByRole("textbox", { name: "Reason", exact: true });
  await reason.fill("Synthetic request reason");
  await page.screenshot({
    path: "test-results/revisit-new-request.png",
    fullPage: true,
  });
  const button = page.getByRole("button", {
    name: "Request review",
    exact: true,
  });
  await button.click();
  await expect(button).toBeDisabled();
  await expect.poll(() => !!completeRequest).toBe(true);
  completeRequest!();
  await expect(page.getByRole("alert")).toContainText(
    "Review service unavailable",
  );
  await expect(button).toBeEnabled();
  await expect(reason).toHaveValue("Synthetic request reason");
  summary = undefined;
  await page.reload();
  await expect(
    page.getByText(
      "Review status is unavailable. Reload the page to try again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request review", exact: true }),
  ).toHaveCount(0);
});

test("a duplicate race refreshes to the existing review", async ({ page }) => {
  await authenticate(page);
  let created = false;
  await page.route("**/api/scans/sample-scan", (route) =>
    route.fulfill({
      json: {
        ...job,
        review: created ? { id: "sample-review", status: "pending" } : null,
      },
    }),
  );
  await page.route("**/api/scans/sample-scan/review", (route) => {
    created = true;
    return route.fulfill({
      status: 409,
      json: { detail: "Review already exists" },
    });
  });
  await page.goto("/jobs/sample-scan");
  await page
    .getByRole("textbox", { name: "Reason", exact: true })
    .fill("Synthetic request reason");
  await page
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "View review details" }),
  ).toHaveAttribute("href", "/reviews/sample-review");
  await expect(
    page.getByRole("textbox", { name: "Reason", exact: true }),
  ).toHaveCount(0);
});

test("authorized staff can follow an existing review but cannot request one for another owner", async ({
  page,
}) => {
  await authenticate(page, true);
  await page.route("**/api/scans/sample-scan", (route) =>
    route.fulfill({
      json: { ...job, review: { id: "sample-review", status: "pending" } },
    }),
  );
  await page.goto("/jobs/sample-scan");
  await expect(
    page.getByRole("link", { name: "View review details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request review", exact: true }),
  ).toHaveCount(0);
});

test("a failed conflict refresh hides the stale request form", async ({
  page,
}) => {
  await authenticate(page);
  let created = false;
  await page.route("**/api/scans/sample-scan", (route) =>
    created
      ? route.fulfill({
          status: 503,
          json: { detail: "Unable to refresh scan" },
        })
      : route.fulfill({ json: { ...job, review: null } }),
  );
  await page.route("**/api/scans/sample-scan/review", (route) => {
    created = true;
    return route.fulfill({
      status: 409,
      json: { detail: "Review already exists" },
    });
  });
  await page.goto("/jobs/sample-scan");
  await page
    .getByRole("textbox", { name: "Reason" })
    .fill("Synthetic request reason");
  await page
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Unable to refresh scan");
  await expect(
    page.getByRole("button", { name: "Request review", exact: true }),
  ).toHaveCount(0);
});

test("an unauthorized scan response does not show a review or request form", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/scans/sample-scan", (route) =>
    route.fulfill({ status: 404, json: { detail: "Scan not found" } }),
  );
  await page.goto("/jobs/sample-scan");
  await expect(page.getByRole("alert")).toContainText("Scan not found");
  await expect(
    page.getByRole("button", { name: "Request review", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "View review details" }),
  ).toHaveCount(0);
});
