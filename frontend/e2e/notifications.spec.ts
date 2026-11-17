import { expect, test, type Page } from "@playwright/test";

const now = Date.now() / 1000;
function examples() {
  return [
    {
      id: "review-alert",
      kind: "review.requested",
      source: "team-tools.zip",
      href: "/reviews/example",
      verdict: "REVIEW",
      created_at: now - 40,
      read_at: null as number | null,
      archived_at: null as number | null,
    },
    {
      id: "scan-alert",
      kind: "scan.completed",
      source: "documentation.zip",
      href: "/jobs/example",
      verdict: "ALLOW",
      created_at: now - 80,
      read_at: null as number | null,
      archived_at: null as number | null,
    },
    {
      id: "failure-alert",
      kind: "scan.failed",
      source: "integration.zip",
      href: "/jobs/failed",
      verdict: null,
      created_at: now - 120,
      read_at: now - 100,
      archived_at: null as number | null,
    },
    {
      id: "comment-alert",
      kind: "comment.created",
      source: "documentation.zip",
      href: "/jobs/example",
      verdict: null,
      created_at: now - 140,
      read_at: null as number | null,
      archived_at: null as number | null,
    },
  ];
}

type MockInbox = {
  items: ReturnType<typeof examples>;
  failList: boolean;
  failCount: boolean;
  failMutation: boolean;
  account: string;
  preferences: {
    scans: boolean;
    review_requests: boolean;
    review_results: boolean;
    review_updates: boolean;
    comments: boolean;
    credentials: boolean;
    exceptions: boolean;
  };
};
async function mockInbox(page: Page, shared?: MockInbox) {
  const model: MockInbox = shared || {
    items: examples(),
    failList: false,
    failCount: false,
    account: "sample-user",
    failMutation: false,
    preferences: {
      scans: true,
      review_requests: true,
      review_results: true,
      review_updates: true,
      comments: true,
      credentials: true,
      exceptions: true,
    },
  };
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: { mode: "local", environment: "test", boards_enabled: false },
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        id: model.account,
        name:
          model.account === "sample-user" ? "Test reviewer" : "Other account",
        role: "user",
        reviewer: true,
      },
    }),
  );
  await page.route("**/api/profile", (route) =>
    route.fulfill({
      json: {
        account_name: "Test reviewer",
        display_name: null,
        role: "user",
        reviewer: true,
      },
    }),
  );
  await page.route("**/api/notification-preferences", async (route) => {
    if (route.request().headers()["x-aag-account"] !== model.account) {
      await route.fulfill({
        status: 409,
        json: { detail: "Notification account changed; reload required" },
      });
      return;
    }
    if (route.request().method() === "PUT")
      Object.assign(model.preferences, route.request().postDataJSON());
    await route.fulfill({ json: model.preferences });
  });
  await page.route("**/api/notifications**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.headers()["x-aag-account"] !== model.account) {
      await route.fulfill({
        status: 409,
        json: { detail: "Notification account changed; reload required" },
      });
      return;
    }
    if (request.method() !== "GET" && model.failMutation) {
      await route.fulfill({
        status: 503,
        json: { detail: "Notification update unavailable" },
      });
      return;
    }
    const unread = () =>
      model.items.filter((n) => !n.read_at && !n.archived_at).length;
    if (url.pathname.endsWith("unread-count")) {
      await route.fulfill(
        model.failCount
          ? { status: 503, json: { detail: "Count unavailable" } }
          : { json: { unread_count: unread() } },
      );
    } else if (url.pathname.endsWith("read-all")) {
      const body = request.postDataJSON();
      let updated = 0;
      for (const n of model.items) {
        if (
          !n.read_at &&
          !n.archived_at &&
          n.created_at <= body.before &&
          (body.category === "all" ||
            n.kind.startsWith(
              body.category === "scans"
                ? "scan."
                : body.category === "reviews"
                  ? "review."
                  : "comment.",
            ))
        ) {
          n.read_at = Date.now() / 1000;
          updated++;
        }
      }
      await route.fulfill({ json: { updated } });
    } else if (request.method() === "PATCH") {
      const n = model.items.find(
        (n) => n.id === url.pathname.split("/").pop(),
      )!;
      const body = request.postDataJSON();
      if ("read" in body) n.read_at = body.read ? Date.now() / 1000 : null;
      if ("archived" in body)
        n.archived_at = body.archived ? Date.now() / 1000 : null;
      await route.fulfill({ json: n });
    } else if (model.failList) {
      await route.fulfill({
        status: 503,
        json: { detail: "Inbox temporarily unavailable" },
      });
    } else {
      const state = url.searchParams.get("state") || "all",
        category = url.searchParams.get("category") || "all";
      const items = model.items.filter(
        (n) =>
          (state === "archived" ? !!n.archived_at : !n.archived_at) &&
          (state !== "unread" || !n.read_at) &&
          (category === "all" ||
            n.kind.startsWith(
              category === "scans"
                ? "scan."
                : category === "reviews"
                  ? "review."
                  : "comment.",
            )),
      );
      const size = Number(url.searchParams.get("page_size") || 25),
        pageNumber = Number(url.searchParams.get("page") || 1);
      await route.fulfill({
        json: {
          items: items.slice((pageNumber - 1) * size, pageNumber * size),
          total: items.length,
          unread_count: unread(),
          filtered_unread_count: items.filter(
            (n) => !n.read_at && !n.archived_at,
          ).length,
          snapshot_at: Date.now() / 1000,
          snapshot_sequence: 10000,
        },
      });
    }
  });
  return model;
}

test("bell preview preserves unread state until opening and links to the inbox", async ({
  page,
}) => {
  const model = await mockInbox(page);
  // This scenario tests the link/read transition, including a removed target.
  await page.route("**/api/scans/example", (route) =>
    route.fulfill({
      status: 404,
      json: { detail: "Synthetic scan unavailable" },
    }),
  );
  await page.goto("/notifications");
  await expect(page.locator(".notification-row")).toHaveCount(4);
  const bell = page.getByRole("button", { name: "Notifications, 3 unread" });
  await bell.click();
  const preview = page.getByRole("menu", { name: "Recent notifications" });
  await expect(preview.getByText("Review requested")).toBeVisible();
  expect(model.items.filter((n) => !n.read_at).length).toBe(3);
  await page.screenshot({
    path: "test-results/notifications-preview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(bell).toBeFocused();
  await bell.click();
  await preview
    .getByRole("menuitem", { name: /View all notifications/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page
    .locator(".notification-row")
    .filter({ hasText: "Scan completed" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/jobs\/example$/);
  expect(
    model.items.find((n) => n.id === "scan-alert")!.read_at,
  ).not.toBeNull();
  await expect(
    page.getByRole("button", { name: "Notifications, 2 unread" }),
  ).toBeVisible();
});

test("filter, read/unread, archive/restore and scoped mark-all work together", async ({
  page,
}) => {
  await mockInbox(page);
  await page.goto("/notifications");
  await page.getByRole("tab", { name: /^Unread/ }).click();
  await expect(page.locator(".notification-row")).toHaveCount(3);
  await page.getByLabel("Notification type").selectOption("scans");
  await expect(page.locator(".notification-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Mark all as read", exact: true })
    .click();
  await expect(page.getByText("No unread notifications")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notifications, 2 unread" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "All", exact: true }).click();
  const row = page
    .locator(".notification-row")
    .filter({ hasText: "Scan completed" });
  await row.getByRole("button", { name: "Mark as unread" }).click();
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".notification-row")).toHaveCount(1);
  await page.getByRole("tab", { name: "Archived", exact: true }).click();
  await expect(page.locator(".notification-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Restore to inbox" }).click();
  await expect(page.getByText("No archived notifications")).toBeVisible();
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByLabel("Notification type").selectOption("all");
  await expect(page.locator(".notification-row")).toHaveCount(4);
  await page.screenshot({
    path: "test-results/notifications-desktop-dark.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("settings persist and the inbox fits light and mobile layouts", async ({
  page,
}) => {
  const model = await mockInbox(page);
  await page.goto("/notifications?view=settings");
  await page.getByLabel("Scan updates").uncheck();
  await page
    .getByRole("button", { name: "Save notification settings" })
    .click();
  await expect(page.getByText("Notification settings saved.")).toBeVisible();
  expect(model.preferences.scans).toBe(false);
  await page.reload();
  await expect(page.getByLabel("Scan updates")).not.toBeChecked();
  await page.screenshot({
    path: "test-results/notifications-settings.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Light mode", exact: true }).click();
  await page.screenshot({
    path: "test-results/notifications-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const bounds = await page.locator(".sidebar").boundingBox();
      return bounds ? bounds.x + bounds.width : 0;
    })
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/notifications-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /Notifications, 3 unread/ }).click();
  await expect(
    page.getByRole("menu", { name: "Recent notifications" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("list and mutation failures remain visible and can be retried", async ({
  page,
}) => {
  const model = await mockInbox(page);
  model.failList = true;
  await page.goto("/notifications");
  await expect(page.getByRole("alert")).toContainText(
    "Inbox temporarily unavailable",
  );
  model.failList = false;
  await page.getByRole("button", { name: "Refresh notifications" }).click();
  await expect(page.locator(".notification-row")).toHaveCount(4);
  model.failMutation = true;
  const row = page
    .locator(".notification-row")
    .filter({ hasText: "Scan completed" });
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("alert")).toContainText(
    "Notification update unavailable",
  );
  await expect(
    row.getByRole("button", { name: "Mark as read", exact: true }),
  ).toBeEnabled();
  model.failMutation = false;
  await row.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Mark as unread" }),
  ).toBeVisible();
});

test("pagination clamps after archiving the last item on a page", async ({
  page,
}) => {
  const model = await mockInbox(page);
  model.items = Array.from({ length: 26 }, (_, i) => ({
    ...examples()[1],
    id: "page-" + i,
    source: "package-" + i + ".zip",
  }));
  await page.goto("/notifications");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".notification-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".notification-row")).toHaveCount(25);
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
});

test("mark-all includes unread notifications beyond the visible page", async ({
  page,
}) => {
  const model = await mockInbox(page);
  model.items = Array.from({ length: 26 }, (_, i) => ({
    ...examples()[1],
    id: "all-" + i,
    read_at: i < 25 ? now - 5 : null,
  }));
  await page.goto("/notifications");
  await expect(page.locator(".notification-row")).toHaveCount(25);
  await page
    .getByRole("button", { name: "Mark all as read", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Notifications, 0 unread" }),
  ).toBeVisible();
});

test("manual list refresh works even when the separate count endpoint is unavailable", async ({
  page,
}) => {
  const model = await mockInbox(page);
  model.failCount = true;
  model.failList = true;
  await page.goto("/notifications");
  await expect(page.getByRole("alert")).toContainText(
    "Inbox temporarily unavailable",
  );
  model.failList = false;
  await page.getByRole("button", { name: "Refresh notifications" }).click();
  await expect(page.locator(".notification-row")).toHaveCount(4);
});

test("a late read response cannot navigate or populate another account's inbox", async ({
  page,
}) => {
  const model = await mockInbox(page);
  let account = "first";
  model.account = account;
  let releaseRead: (() => void) | undefined;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { id: account, name: account, role: "user", reviewer: false },
    }),
  );
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/auth/login", (route) => {
    account = "second";
    model.account = account;
    model.items = [];
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/notifications/scan-alert", async (route) => {
    await new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    await route.fulfill({
      json: { ...examples()[1], read_at: Date.now() / 1000 },
    });
  });
  await page.goto("/notifications");
  await page
    .locator(".notification-row")
    .filter({ hasText: "Scan completed" })
    .getByRole("link")
    .click();
  await expect.poll(() => !!releaseRead).toBe(true);
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByLabel(/사용자명|Username/).fill("second");
  await page.getByLabel(/비밀번호|Password/).fill("test-password-long");
  await page
    .getByRole("button", { name: /^(로그인|Sign in)$/, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Notifications, 0 unread" }),
  ).toBeVisible();
  releaseRead!();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByText("No notifications yet")).toBeVisible();
  await expect(page.locator(".notification-row")).toHaveCount(0);
});

test("refreshing counts does not discard unsaved notification preferences", async ({
  page,
}) => {
  await mockInbox(page);
  await page.goto("/notifications?view=settings");
  await page.getByLabel("Scan updates").uncheck();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Notifications, 3 unread" }),
  ).toBeVisible();
  await expect(page.getByLabel("Scan updates")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Save notification settings" }),
  ).toBeEnabled();
});

test("background refresh preserves focused rows and scroll while loading", async ({
  page,
}) => {
  const model = await mockInbox(page);
  model.items = Array.from({ length: 25 }, (_, i) => ({
    ...examples()[1],
    id: "focus-" + i,
  }));
  await page.goto("/notifications");
  await expect(page.locator(".notification-row")).toHaveCount(25);
  const action = page
    .locator(".notification-row")
    .last()
    .getByRole("button", { name: "Archive", exact: true });
  await action.focus();
  const position = await page.evaluate(() => window.scrollY);
  let release: (() => void) | undefined;
  await page.route("**/api/notifications?**", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => !!release).toBe(true);
  await expect(action).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(
    position - 1,
  );
  release!();
  await expect(action).toBeFocused();
});

test("saving a changed preference preserves unrelated changes from another device", async ({
  page,
}) => {
  const model = await mockInbox(page);
  await page.goto("/notifications?view=settings");
  await page.getByLabel("Scan updates").uncheck();
  model.preferences.comments = false;
  await page
    .getByRole("button", { name: "Save notification settings" })
    .click();
  await expect(page.getByText("Notification settings saved.")).toBeVisible();
  expect(model.preferences.comments).toBe(false);
});

test("a stale settings form cannot write after the session account changes elsewhere", async ({
  page,
}) => {
  const model = await mockInbox(page);
  await page.route("**/api/notification-preferences", async (route) => {
    const expected = route.request().headers()["x-aag-account"];
    if (expected !== model.account) {
      await route.fulfill({
        status: 409,
        json: { detail: "Notification account changed; reload required" },
      });
      return;
    }
    await route.fallback();
  });
  await page.goto("/notifications?view=settings");
  await page.getByLabel("Scan updates").uncheck();
  model.account = "other-account";
  await page
    .getByRole("button", { name: "Save notification settings" })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu: Other account" }),
  ).toBeVisible();
  expect(model.preferences.scans).toBe(true);
});

test("a tab reconciles its identity after another tab switches the session account", async ({
  page,
  context,
}) => {
  const model = await mockInbox(page);
  await page.goto("/notifications");
  await expect(page.locator(".notification-row")).toHaveCount(4);
  const other = await context.newPage();
  await mockInbox(other, model);
  await other.goto("/notifications");
  model.account = "other-account";
  model.items = [];
  await other.reload();
  await expect(
    other.getByRole("button", { name: "Account menu: Other account" }),
  ).toBeVisible();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Account menu: Other account" }),
  ).toBeVisible();
  await expect(page.getByText("No notifications yet")).toBeVisible();
  await other.close();
});

test("notification links also mark read when opened by their new-tab URL", async ({
  page,
}) => {
  const model = await mockInbox(page);
  await page.goto("/notifications");
  const link = page
    .locator(".notification-row")
    .filter({ hasText: "Scan completed" })
    .getByRole("link");
  const href = await link.getAttribute("href");
  expect(href).toBe("/notifications/open/scan-alert");
  await page.goto(href!);
  await expect(page).toHaveURL(/\/jobs\/example$/);
  expect(
    model.items.find((n) => n.id === "scan-alert")!.read_at,
  ).not.toBeNull();
});

test("mark-all is disabled when only other categories have unread items", async ({
  page,
}) => {
  const model = await mockInbox(page);
  model.items.find((n) => n.id === "scan-alert")!.read_at = now;
  await page.goto("/notifications?category=scans");
  await expect(page.locator(".notification-row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Mark all as read", exact: true }),
  ).toBeDisabled();
});

test("a real scan creates a persistent inbox item and opens its result", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel(/사용자명|Username/).fill("admin");
  await page.getByLabel(/비밀번호|Password/).fill("test-password-long");
  await page
    .getByRole("button", { name: /^(로그인|Sign in)$/, exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "검사 현황" })).toBeVisible();
  const accountId = (await (await page.request.get("/api/auth/me")).json()).id;
  await page.request.put("/api/notification-preferences", {
    headers: { Origin: new URL(page.url()).origin, "X-AAG-Account": accountId },
    data: { scans: true },
  });
  const { execFileSync } = await import("node:child_process");
  const archive = execFileSync("python3", [
    "-c",
    'import io,zipfile,sys;b=io.BytesIO();z=zipfile.ZipFile(b,"w");z.writestr("README.md","Synthetic read-only documentation");z.close();sys.stdout.buffer.write(b.getvalue())',
  ]);
  const filename = "notification-e2e-" + Date.now() + ".zip";
  const submitted = await page.request.post("/api/scans/upload", {
    headers: { Origin: new URL(page.url()).origin },
    multipart: {
      file: { name: filename, mimeType: "application/zip", buffer: archive },
      profile: "static",
    },
  });
  expect(submitted.status()).toBe(202);
  const id = (await submitted.json()).id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/scans/" + id)).json()).status,
    )
    .toBe("COMPLETED");
  await page.goto("/notifications");
  const row = page.locator(".notification-row").filter({ hasText: filename });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "읽음으로 표시", exact: true }).click();
  await page.reload();
  await expect(
    row.getByRole("button", { name: "안 읽음으로 표시", exact: true }),
  ).toBeVisible();
  await row.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp("/jobs/" + id + "$"));
  await expect(page.locator(".admission-header h2")).toHaveText("ALLOW");
});

for (const oldOperation of ["read", "preferences"]) {
  test(`an old notification ${oldOperation} cannot clear new same-account input`, async ({
    page,
  }) => {
    const model = await mockInbox(page);
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({ json: { ok: true } }),
    );
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ json: { ok: true } }),
    );
    let release!: () => void;
    let started = false;
    const delayed = new Promise<void>((done) => {
      release = done;
    });
    const path =
      oldOperation === "read"
        ? "**/api/notifications/scan-alert"
        : "**/api/notification-preferences";
    await page.route(path, async (route) => {
      if (route.request().method() === "GET") return route.fallback();
      started = true;
      await delayed;
      await route.fulfill({
        json:
          oldOperation === "read"
            ? { ...examples()[1], read_at: now }
            : model.preferences,
      });
    });
    await page.goto(
      "/notifications" +
        (oldOperation === "preferences" ? "?view=settings" : ""),
    );
    if (oldOperation === "read") {
      await page
        .locator(".notification-row")
        .filter({ hasText: "Scan completed" })
        .getByRole("link")
        .click();
    } else {
      await page.getByLabel("Scan updates").uncheck();
      await page
        .getByRole("button", { name: "Save notification settings" })
        .click();
    }
    await expect.poll(() => started).toBe(true);
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.getByLabel("Username").fill(model.account);
    await page.getByLabel("Password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByRole("checkbox", { name: /Comments/ }).uncheck();
    const response = page.waitForResponse(
      (r) =>
        r
          .url()
          .includes(
            oldOperation === "read"
              ? "/notifications/scan-alert"
              : "/notification-preferences",
          ) && r.request().method() !== "GET",
    );
    release();
    await response;
    // Any erroneous reconciliation remounts the form and restores this checkbox.
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    await expect(
      page.getByRole("checkbox", { name: /Comments/ }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Save notification settings" }),
    ).toBeEnabled();
  });
}
