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
async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto(provider.origin + "/jobs?scope=personal");
  await page.getByRole("link", { name: "Sign in with SSO" }).click();
  await expect(page).toHaveURL(provider.origin + "/jobs?scope=personal");
  await expect(
    page.getByRole("heading", { name: "Scans", exact: true }),
  ).toBeVisible();
  const rows = await (
    await page.request.get(provider.origin + "/api/saved-views?resource=jobs", {
      headers: { "X-AAG-Account": "a1-alice", Origin: provider.origin },
    })
  ).json();
  for (const v of rows)
    await page.request.delete(provider.origin + "/api/saved-views/" + v.id, {
      headers: { "X-AAG-Account": "a1-alice", Origin: provider.origin },
      data: { expected_revision: v.revision },
    });
  await page.reload();
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  const directory = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-a3",
  );
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
}
async function create(
  page: Page,
  name: string,
  filters = { version: 1, scope: "personal" },
  is_default = false,
) {
  const response = await page.request.post(
    provider.origin + "/api/saved-views",
    {
      headers: { "X-AAG-Account": "a1-alice", Origin: provider.origin },
      data: { resource: "jobs", name, filters, is_default },
    },
  );
  expect(response.status()).toBe(201);
  return response.json();
}
test("saves current filters, applies default after login, and keeps explicit URL", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    provider.origin + "/jobs?scope=personal&verdict=BLOCK&page=1",
  );
  await page.getByLabel("View name", { exact: true }).fill("Blocked sources");
  await page
    .getByRole("button", { name: "Save current view", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply · Blocked sources", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Set default · Blocked sources", exact: true })
    .click();
  await expect(page.getByText("Default view", { exact: true })).toBeVisible();
  await capture(page, "saved-default-desktop-dark");
  await page.goto(provider.origin + "/jobs?scope=personal&verdict=ALLOW");
  await expect(page.getByLabel("Verdict", { exact: true })).toHaveValue(
    "ALLOW",
  );
  await page.request.post(provider.origin + "/api/auth/logout", {
    headers: { Origin: provider.origin },
  });
  await page.goto(provider.origin + "/jobs");
  await page.getByRole("link", { name: "Sign in with SSO" }).click();
  await expect(page).toHaveURL(/verdict=BLOCK/);
  await page.evaluate(() => {
    localStorage.setItem("aag-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
  await capture(page, "saved-default-desktop-light");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "saved-default-mobile-light");
});

test("restores page three query, row and scroll through detail, direct entry and history", async ({
  page,
}) => {
  await login(page);
  let total = 76;
  await page.route("**/api/scans?**", async (route) => {
    const pageNumber = Number(
      new URL(route.request().url()).searchParams.get("page") || 1,
    );
    const item = await (
      await page.request.get(provider.origin + "/api/scans/a1-synthetic-job")
    ).json();
    await route.fulfill({
      json: {
        items: Array.from(
          { length: Math.min(25, Math.max(0, total - (pageNumber - 1) * 25)) },
          (_, i) => ({
            ...item,
            source: `synthetic-source-${(pageNumber - 1) * 25 + i}.zip`,
          }),
        ),
        total,
        page: pageNumber,
        page_size: 25,
      },
    });
  });
  const path =
    "/jobs?scope=personal&q=synthetic&status=COMPLETED&verdict=BLOCK&days=90&page=3";
  await page.goto(provider.origin + path);
  const row = page.getByRole("link", {
    name: "synthetic-source-67.zip",
    exact: true,
  });
  await row.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await row.click();
  await page
    .locator("main")
    .getByRole("link", { name: "Scans", exact: true })
    .click();
  await expect(page).toHaveURL(provider.origin + path);
  await expect(
    page.getByRole("link", { name: "synthetic-source-67.zip", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(Math.max(0, before - 60));
  await page.goBack();
  await expect(page).toHaveURL(/\/jobs\/a1-synthetic-job$/);
  await page.goForward();
  await expect(page).toHaveURL(provider.origin + path);
  await page.goto(provider.origin + "/jobs/a1-synthetic-job");
  await page
    .locator("main")
    .getByRole("link", { name: "Scans", exact: true })
    .click();
  await expect(page).toHaveURL(provider.origin + path);
  total = 28;
  await page.reload();
  await expect(page).toHaveURL(/page=2/);
});

test("direct details without prior list use the standard list", async ({
  page,
}) => {
  await login(page);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(provider.origin + "/jobs/a1-synthetic-job");
  await page
    .locator("main")
    .getByRole("link", { name: "Scans", exact: true })
    .click();
  await expect(page).toHaveURL(provider.origin + "/jobs");
});

test("permission loss explains the unavailable default and permits scope repair", async ({
  page,
}) => {
  await login(page);
  await create(page, "Staff queue", { version: 1, scope: "all" }, true);
  // Model the earlier staff observation at the browser's authorization read
  // boundary; the backend suite separately removes real reviewer qualification.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { id: "a1-alice", name: "alice", role: "user", reviewer: true },
    }),
  );
  await page.route("**/api/saved-views?resource=jobs", async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    await route.fulfill({
      json: rows.map((view: any) => ({
        ...view,
        usable: true,
        invalid_reason: null,
      })),
    });
  });
  await page.goto(provider.origin + "/jobs?scope=personal");
  await expect(
    page.getByRole("button", { name: "Apply · Staff queue" }),
  ).toBeEnabled();
  await page.unroute("**/api/auth/me");
  await page.unroute("**/api/saved-views?resource=jobs");
  await page.goto(provider.origin + "/jobs");
  await expect(
    page.getByText(/Staff access required; edit scope/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply · Staff queue" }),
  ).toBeDisabled();
  await capture(page, "permission-unavailable-desktop");
  await page
    .getByRole("button", { name: "Edit · Staff queue", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Saved scope", exact: true })
    .selectOption("personal");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply · Staff queue" }),
  ).toBeEnabled();
  await page.goto(provider.origin + "/jobs?scope=all&page=3");
  await expect(
    page.getByText(/Staff access required; edit scope/).first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/scope=all/);
});

test("another tab revision conflict preserves input until explicit re-edit", async ({
  page,
  context,
}) => {
  await login(page);
  const view = await create(page, "Team source");
  await page.reload();
  await page
    .getByRole("button", { name: "Edit · Team source", exact: true })
    .click();
  await page.getByLabel("View name", { exact: true }).fill("My retained name");
  const second = await context.newPage();
  await second.goto(provider.origin + "/jobs?scope=personal");
  await second
    .getByRole("button", { name: "Edit · Team source", exact: true })
    .click();
  await second.getByLabel("View name", { exact: true }).fill("Other tab name");
  await second
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    second.getByRole("button", { name: "Apply · Other tab name" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Saved view changed");
  await expect(page.getByLabel("View name", { exact: true })).toHaveValue(
    "My retained name",
  );
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await capture(page, "revision-conflict-desktop");
  await page.getByRole("button", { name: "Re-edit latest revision" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply · My retained name" }),
  ).toBeVisible();
  expect(view.revision).toBe(1);
});

test("delayed accepted save preserves newer edits and settles pending", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let accepted!: () => void;
  const saved = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  await page.route("**/api/saved-views", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    accepted();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByLabel("View name", { exact: true }).fill("First view");
  await page
    .getByRole("button", { name: "Save current view", exact: true })
    .click();
  await saved;
  await page
    .getByLabel("View name", { exact: true })
    .fill("Newer unsaved name");
  release();
  await expect(
    page.getByRole("button", { name: "Save current view", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("View name", { exact: true })).toHaveValue(
    "Newer unsaved name",
  );
});

test("search changes debounce and reset the page while preserving other filters", async ({
  page,
}) => {
  await login(page);
  await page.goto(provider.origin + "/jobs?scope=personal&verdict=BLOCK");
  await page.getByLabel("Search source", { exact: true }).fill("synthetic");
  await expect(page).toHaveURL(/q=synthetic/);
  expect(new URL(page.url()).searchParams.get("page")).toBe("1");
  expect(new URL(page.url()).searchParams.get("verdict")).toBe("BLOCK");
});

test("duplicate-name failure allows correcting the name and explicitly retrying", async ({
  page,
}) => {
  await login(page);
  await create(page, "Existing view");
  await page.reload();
  await page.getByLabel("View name", { exact: true }).fill("Existing view");
  await page
    .getByRole("button", { name: "Save current view", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("already exists");
  await page.getByLabel("View name", { exact: true }).fill("Corrected view");
  await expect(
    page.getByRole("button", { name: "Save current view", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save current view", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply · Corrected view" }),
  ).toBeVisible();
});

test("review lists return with their tab and explicit queries override review defaults", async ({
  page,
}) => {
  await login(page);
  const response = await page.request.post(
    provider.origin + "/api/scans/a1-synthetic-job/review",
    {
      headers: { Origin: provider.origin, "X-AAG-Account": "a1-alice" },
      data: { reason: "Synthetic A3 review navigation" },
    },
  );
  expect(response.status()).toBe(201);
  const review = await response.json();
  const saved = await page.request.post(provider.origin + "/api/saved-views", {
    headers: { Origin: provider.origin, "X-AAG-Account": "a1-alice" },
    data: {
      resource: "reviews",
      name: "My pending reviews",
      filters: { version: 1, tab: "mine", status: "pending" },
      is_default: true,
    },
  });
  expect(saved.status()).toBe(201);
  await page.goto(provider.origin + "/reviews?tab=mine&status=pending&page=1");
  await page
    .getByRole("link", { name: "synthetic-package.zip", exact: true })
    .click();
  await expect(page).toHaveURL(provider.origin + "/reviews/" + review.id);
  await page.getByRole("link", { name: "Reviews list", exact: true }).click();
  await expect(page).toHaveURL(
    provider.origin + "/reviews?tab=mine&status=pending&page=1",
  );
  await page.goto(provider.origin + "/reviews?tab=mine&status=rejected");
  await expect(page).toHaveURL(/status=rejected/);
  await expect(
    page.getByText("No reviews in this queue.", { exact: true }),
  ).toBeVisible();
  await page.goto(provider.origin + "/reviews?tab=all");
  await expect(page.getByRole("alert")).toContainText("Staff access required");
  await expect(page).toHaveURL(/tab=all/);
});

test("late response after navigation cannot clear the replacement saved-view form", async ({
  page,
}) => {
  await login(page);
  let release!: () => void, accepted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  let completed!: () => void;
  const settled = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route("**/api/saved-views", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    accepted();
    await gate;
    await route.fulfill({ response });
    completed();
  });
  await page.getByLabel("View name", { exact: true }).fill("Departing form");
  await page
    .getByRole("button", { name: "Save current view", exact: true })
    .click();
  await saved;
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("link", { name: "Scans", exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill("Replacement input");
  release();
  await settled;
  await expect(
    page.getByRole("button", { name: "Save current view", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("View name", { exact: true })).toHaveValue(
    "Replacement input",
  );
});

test("late default read cannot replace a newer explicit URL", async ({
  page,
}) => {
  await login(page);
  await create(
    page,
    "Blocked default",
    { version: 1, scope: "personal", verdict: "BLOCK" } as {
      version: number;
      scope: string;
    },
    true,
  );
  let release!: () => void, captured!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let finished!: () => void;
  const settled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(
    "**/api/saved-views?resource=jobs",
    async (route) => {
      const response = await route.fetch();
      captured();
      await gate;
      await route.fulfill({ response });
      finished();
    },
    { times: 1 },
  );
  await page.goto(provider.origin + "/jobs");
  await pending;
  await page.getByLabel("Verdict", { exact: true }).selectOption("ALLOW");
  release();
  await settled;
  await expect(
    page.getByRole("button", { name: "Apply · Blocked default" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/verdict=ALLOW/);
  await expect(page.getByLabel("Verdict", { exact: true })).toHaveValue(
    "ALLOW",
  );
});

test("ambiguous accepted save requires a latest read before an explicit retry", async ({
  page,
}) => {
  await login(page);
  await page.route(
    "**/api/saved-views",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByLabel("View name", { exact: true }).fill("Possibly accepted");
  await page
    .getByRole("button", { name: "Save current view", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save current view", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reload views", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply · Possibly accepted" }),
  ).toBeVisible();
  await expect(page.getByLabel("View name", { exact: true })).toHaveValue(
    "Possibly accepted",
  );
  await expect(
    page.getByRole("button", { name: "Save current view", exact: true }),
  ).toBeEnabled();
});

for (const initialStatus of [200, 503]) {
  test(`a late initial view read ${initialStatus} cannot erase the list refreshed by a completed save`, async ({
    page,
  }) => {
    await login(page);
    let release!: () => void, captured!: () => void, completed!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const settled = new Promise<void>((resolve) => {
      completed = resolve;
    });
    await page.route(
      "**/api/saved-views?resource=jobs",
      async (route) => {
        const response = await route.fetch();
        captured();
        await gate;
        if (initialStatus === 503)
          await route.fulfill({
            status: 503,
            json: { detail: "Synthetic stale read failed" },
          });
        else await route.fulfill({ response });
        completed();
      },
      { times: 1 },
    );
    await page.goto(provider.origin + "/jobs?scope=personal");
    await pending;
    await page
      .getByLabel("View name", { exact: true })
      .fill("Saved after initial read");
    await page
      .getByRole("button", { name: "Save current view", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Apply · Saved after initial read" }),
    ).toBeVisible();
    release();
    await settled;
    await expect(
      page.getByRole("button", { name: "Apply · Saved after initial read" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("a fresh queryless entry applies a default despite an old standard-list memory", async ({
  page,
}) => {
  await login(page);
  await create(
    page,
    "Fresh entry default",
    { version: 1, scope: "personal", verdict: "BLOCK" } as {
      version: number;
      scope: string;
    },
    true,
  );
  await page.evaluate(() =>
    sessionStorage.setItem(
      "aag-list:a1-alice:jobs",
      JSON.stringify({
        accountId: "a1-alice",
        resource: "jobs",
        list_url: "/jobs",
        scroll_y: 0,
      }),
    ),
  );
  await page.evaluate(() =>
    history.replaceState(
      { ...history.state, key: "retained-router-key" },
      "",
      "/jobs",
    ),
  );
  await page.reload();
  await expect(page).toHaveURL(/verdict=BLOCK/);
});

test("within-document back to an observed queryless list preserves its standard state", async ({
  page,
}) => {
  await login(page);
  await page.goto(provider.origin + "/jobs");
  await expect(
    page.getByText("No saved views.", { exact: true }),
  ).toBeVisible();
  await create(
    page,
    "Later default",
    { version: 1, scope: "personal", verdict: "BLOCK" } as {
      version: number;
      scope: string;
    },
    true,
  );
  await page.getByRole("link", { name: "+ New scan", exact: true }).click();
  await expect(page).toHaveURL(provider.origin + "/new");
  await expect(
    page.getByRole("heading", { name: "Start a new scan", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Apply · Later default" }),
  ).toBeVisible();
  await expect(page).toHaveURL(provider.origin + "/jobs");
  await expect(page.getByLabel("Verdict", { exact: true })).toHaveValue("");
});

test("unknown credential query fields never enter detail return state", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    provider.origin + "/jobs?scope=personal&token=synthetic-secret",
  );
  await page
    .getByRole("link", { name: "synthetic-package.zip", exact: true })
    .click();
  await expect(page).toHaveURL(provider.origin + "/jobs/a1-synthetic-job");
  expect(
    await page.evaluate(() => JSON.stringify(history.state)),
  ).not.toContain("synthetic-secret");
});
