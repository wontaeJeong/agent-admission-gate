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
const sha = "a".repeat(40);
const origin = {
  id: "rerun-origin",
  owner_id: "a1-alice",
  source: "https://github.com/example/synthetic.git",
  source_type: "git",
  ref: "release",
  profile: "full",
  status: "COMPLETED",
  resolved_commit: sha as string | null,
  target_commit: null as string | null,
  rerun_mode: null as string | null,
  result: {},
  review: null,
  created_at: 1,
};
async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto(provider.origin + "/jobs");
  await page.getByRole("link", { name: "Sign in with SSO" }).click();
  await expect(
    page.getByRole("heading", { name: "Scans", exact: true }),
  ).toBeVisible();
}
async function mockOrigin(page: Page, value = origin) {
  await page.route("**/api/scans/rerun-origin", (route) =>
    route.fulfill({ json: value }),
  );
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  const dir = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-b1",
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
test("latest prefill waits for GET, requires explicit submit and preserves receipt edits", async ({
  page,
}) => {
  await login(page);
  await mockOrigin(page);
  let posts = 0;
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/scans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    expect(route.request().headers()["x-aag-account"]).toBe("a1-alice");
    expect(route.request().postDataJSON()).toMatchObject({
      origin_job_id: origin.id,
      rerun_mode: "latest",
      url: origin.source,
      ref: "release",
      profile: "full",
      force_rescan: false,
    });
    await hold;
    await route.fulfill({ status: 202, json: { id: "accepted" } });
  });
  await page.goto(provider.origin + "/new?from=rerun-origin&mode=latest");
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    origin.source,
  );
  await expect(page.getByLabel("Branch or tag", { exact: true })).toHaveValue(
    "release",
  );
  expect(posts).toBe(0);
  await capture(page, "latest-desktop-dark");
  await page.getByRole("button", { name: "Run scan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Submitting…" }),
  ).toBeDisabled();
  await page.getByLabel("Branch or tag", { exact: true }).fill("new-edit");
  release();
  await expect(
    page.getByRole("button", { name: "Run scan", exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/\/new\?/);
  await expect(page.getByLabel("Branch or tag", { exact: true })).toHaveValue(
    "new-edit",
  );
  expect(posts).toBe(1);
});
test("snapshot retries stored target, keeps PAT private, and checks latest after uncertain POST", async ({
  page,
}) => {
  await login(page);
  await mockOrigin(page, {
    ...origin,
    status: "FAILED",
    resolved_commit: null,
    target_commit: sha,
    rerun_mode: "snapshot",
  });
  let posts = 0;
  await page.route("**/api/scans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    expect(route.request().postDataJSON()).toMatchObject({
      target_commit: sha,
      ref: null,
      credential: "synthetic-pat",
      rerun_mode: "snapshot",
    });
    await route.abort("failed");
  });
  await page.goto(provider.origin + "/new?from=rerun-origin&mode=snapshot");
  await expect(page.getByLabel("Recorded commit", { exact: true })).toHaveValue(
    sha,
  );
  await page
    .getByText("Private repository credentials", { exact: true })
    .click();
  await page
    .getByLabel("Personal access token", { exact: true })
    .fill("synthetic-pat");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await capture(page, "snapshot-desktop-light");
  await page.getByRole("button", { name: "Run scan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check latest scans", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run scan", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.stringify(sessionStorage)),
  ).not.toContain("synthetic-pat");
  await capture(page, "uncertain-failure-desktop-light");
  await page
    .getByRole("button", { name: "Check latest scans", exact: true })
    .click();
  await expect(
    page.getByText(
      "Latest scans checked. Review the list before submitting again.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(posts).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "uncertain-failure-mobile-light");
});
test("ZIP rerun requires reselection and explicitly chooses original settings over draft", async ({
  page,
}) => {
  await login(page);
  await mockOrigin(page, {
    ...origin,
    source: "package.zip",
    source_type: "upload",
    ref: null as any,
    profile: "static",
    resolved_commit: null,
  });
  await page.goto(provider.origin + "/new");
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://github.com/draft/other");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved in this tab" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Restore previous draft", exact: true }),
  ).toBeVisible();
  await page.goto(provider.origin + "/new?from=rerun-origin&mode=latest");
  await expect(
    page.getByText(
      "Choose original scan settings or restore the previous draft as an unlinked new scan.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use original scan settings", exact: true })
    .click();
  await expect(page.locator("input[type=file]")).toHaveValue("");
  await capture(page, "zip-reselection-desktop-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "zip-reselection-mobile-dark");
  await page.getByRole("button", { name: "Run scan", exact: true }).click();
  await expect(page).toHaveURL(/\/new\?/);
});
test("denied origin never prefills and missing snapshot remains unavailable", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/scans/rerun-origin", (route) =>
    route.fulfill({ status: 404, json: { detail: "Scan not found" } }),
  );
  await page.goto(provider.origin + "/new?from=rerun-origin&mode=snapshot");
  await expect(page.getByText("Scan not found", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveCount(
    0,
  );
  await capture(page, "origin-denied-desktop-dark");
  await page.unroute("**/api/scans/rerun-origin");
  await mockOrigin(page, { ...origin, resolved_commit: null });
  await page.reload();
  await expect(
    page.getByText("No recorded commit is available for this scan.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("restored draft is unlinked and does not inherit snapshot intent", async ({
  page,
}) => {
  await login(page);
  await mockOrigin(page);
  await page.goto(provider.origin + "/new");
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://github.com/draft/other");
  await page.getByLabel("Branch or tag", { exact: true }).fill("draft-branch");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved in this tab" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Restore previous draft", exact: true }),
  ).toBeVisible();
  await page.goto(provider.origin + "/new?from=rerun-origin&mode=snapshot");
  await page
    .getByRole("button", { name: "Restore previous draft", exact: true })
    .click();
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    "https://github.com/draft/other",
  );
  await expect(page.getByLabel("Recorded commit", { exact: true })).toHaveCount(
    0,
  );
  await page.route("**/api/scans", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ ref: "draft-branch", profile: "static" });
    expect(body.origin_job_id).toBeUndefined();
    expect(body.target_commit).toBeUndefined();
    await route.fulfill({
      status: 422,
      json: { detail: "Synthetic validation rejection" },
    });
  });
  await page.getByRole("button", { name: "Run scan", exact: true }).click();
  await expect(
    page.getByText("Synthetic validation rejection", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Branch or tag", { exact: true })).toHaveValue(
    "draft-branch",
  );
});

test("real ZIP rerun retains explicit lineage and result origin link", async ({
  page,
}) => {
  await login(page);
  // A tiny valid stored ZIP; only static source text is uploaded.
  const zip = Buffer.from(
    "UEsDBBQAAAAAADBtYVsAAAAAAAAAAAAAAAAJAAAAcmVhZG1lLm1kUEsBAhQDFAAAAAAAMG1hWwAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS5tZFBLBQYAAAAAAQABADcAAAAnAAAAAAA=",
    "base64",
  );
  const created = await page.request.post(
    provider.origin + "/api/scans/upload",
    {
      headers: { Origin: provider.origin, "X-AAG-Account": "a1-alice" },
      multipart: {
        file: { name: "source.zip", mimeType: "application/zip", buffer: zip },
      },
    },
  );
  expect(created.status()).toBe(202);
  const job = await created.json();
  await page.goto(provider.origin + "/jobs/" + job.id);
  await page
    .getByRole("link", { name: "Select ZIP again", exact: true })
    .click();
  await expect(page.locator("input[type=file]")).toHaveValue("");
  await page.locator("input[type=file]").setInputFiles({
    name: "renamed.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  const submitted = page.waitForResponse(
    (response) =>
      response.url() === provider.origin + "/api/scans/upload" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run scan", exact: true }).click();
  const result = await (await submitted).json();
  expect(result.origin_job_id).toBe(job.id);
  expect(result.lineage_root_id).toBe(job.id);
  await expect(page).toHaveURL(provider.origin + "/jobs/" + result.id);
  await expect(
    page.getByRole("link", { name: "Origin scan ↗", exact: true }),
  ).toHaveAttribute("href", "/jobs/" + job.id);
});

test("late GET cannot prefill a replacement route", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/scans/rerun-origin", async (route) => {
    await hold;
    await route.fulfill({ json: origin });
  });
  await page.goto(provider.origin + "/new?from=rerun-origin&mode=latest");
  await expect(
    page.getByRole("status").filter({ hasText: "Loading…" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "New scan", exact: true }).click();
  await expect(page).toHaveURL(provider.origin + "/new");
  await expect(page.getByLabel("Rerun settings", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://github.com/new/route");
  release();
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    "https://github.com/new/route",
  );
  await expect(page.getByLabel("Rerun settings", { exact: true })).toHaveCount(
    0,
  );
});

test("late POST cannot clear a replacement scan draft", async ({ page }) => {
  await login(page);
  await mockOrigin(page);
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  let completed = false;
  await page.route("**/api/scans", async (route) => {
    await hold;
    await route.fulfill({ status: 202, json: { id: "old-accepted" } });
    completed = true;
  });
  await page.goto(provider.origin + "/new?from=rerun-origin&mode=latest");
  await page.getByRole("button", { name: "Run scan", exact: true }).click();
  await page.getByRole("link", { name: "New scan", exact: true }).click();
  await expect(page).toHaveURL(provider.origin + "/new");
  await expect(page.getByLabel("Rerun settings", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://github.com/new/keep");
  release();
  await expect.poll(() => completed).toBe(true);
  await expect(page).toHaveURL(provider.origin + "/new");
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    "https://github.com/new/keep",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Restore previous draft", exact: true })
    .click();
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    "https://github.com/new/keep",
  );
});
