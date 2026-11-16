import { expect, test } from "@playwright/test";

test("local login returns to the validated destination", async ({ page }) => {
  await page.goto(
    "/login?return_to=%2Fjobs%3Fscope%3Dpersonal%26page%3D3%26token%3Ddiscarded",
  );
  await page.getByLabel(/사용자명|Username/).fill("admin");
  await page.getByLabel(/비밀번호|Password/).fill("test-password-long");
  await page
    .getByRole("button", { name: /^(로그인|Sign in)$/, exact: true })
    .click();
  await expect(page).toHaveURL(/\/jobs\?scope=personal&page=3$/);
});

test("expired requests show one reauthentication notice and retain destination", async ({
  page,
  context,
}) => {
  // Use the isolated provider app so this regression does not consume the
  // shared local backend's ten-login/minute security budget.
  await page.goto(oidcOrigin + "/settings");
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await expect(page.getByRole("button", { name: /계정 메뉴/ })).toBeVisible();
  let release!: () => void;
  const responses = new Promise<void>((done) => {
    release = done;
  });
  let unauthorized = 0;
  for (const path of ["**/api/notifications/unread-count", "**/api/scans?**"]) {
    await page.route(path, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(401);
      unauthorized++;
      await responses;
      await route.fulfill({ response });
    });
  }
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("link", { name: "작업 목록", exact: true }).click();
  await expect.poll(() => unauthorized).toBe(2);
  release();
  await expect(
    page.getByRole("alert").filter({ hasText: "세션이 만료" }),
  ).toHaveCount(1);
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page.getByRole("link", { name: "SSO로 로그인" })).toBeVisible();
});

// A separate OIDC app keeps provider fixtures outside production and the local-login suite.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const evidence =
  process.env.AAG_CAPTURE_EVIDENCE === "1"
    ? resolve(root, "docs/engineering/screenshots/convenience-a1")
    : resolve(root, "frontend/test-results/convenience-a1");
let providerApp: ChildProcess;
let oidcOrigin: string;
let fixtureDirectory: string;

// Only this synthetic provider uses an ephemeral self-signed loopback certificate.
test.use({ ignoreHTTPSErrors: true });

test.beforeAll(async () => {
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const port = address.port;
  await new Promise<void>((done, reject) =>
    socket.close((error) => (error ? reject(error) : done())),
  );
  oidcOrigin = `http://localhost:${port}`;
  fixtureDirectory = mkdtempSync(resolve(tmpdir(), "aag-oidc-browser-"));
  providerApp = spawn(
    resolve(root, ".venv/bin/python"),
    [
      "-m",
      "uvicorn",
      "frontend.e2e.oidc_app:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-access-log",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${root}/.venv/bin:/usr/bin:/bin`,
        AAG_PUBLIC_URL: oidcOrigin,
        AAG_DATABASE_URL: `sqlite:///${fixtureDirectory}/fixture.db`,
        AAG_OIDC_FIXTURE_DIR: fixtureDirectory,
      },
      stdio: "ignore",
    },
  );
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${oidcOrigin}/health/ready`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 15000 },
    )
    .toBe(200);
  mkdirSync(evidence, { recursive: true });
});
test.afterAll(async () => {
  if (providerApp && providerApp.exitCode === null) {
    providerApp.kill("SIGTERM");
    await new Promise<void>((done) => providerApp.once("exit", () => done()));
  }
  if (fixtureDirectory)
    rmSync(fixtureDirectory, { recursive: true, force: true });
});

const findingPath =
  "/jobs/a1-synthetic-job?tab=findings&finding=synthetic-finding&occurrence=0";

test("real OIDC callback preserves the exact finding URL and renders authorized content", async ({
  page,
  context,
}) => {
  await page.goto(oidcOrigin + findingPath);
  await expect(
    page.getByRole("link", { name: "SSO로 로그인" }),
  ).toHaveAttribute(
    "href",
    "/api/auth/oidc/login?return_to=" + encodeURIComponent(findingPath),
  );
  await page.screenshot({
    path: resolve(evidence, "login-desktop-dark.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await expect(page).toHaveURL(oidcOrigin + findingPath);
  await expect(
    page.getByRole("heading", { name: "Synthetic finding for login return" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "return-desktop-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /계정 메뉴/ }).click();
  await page.getByRole("menuitem", { name: "라이트 모드" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: resolve(evidence, "return-desktop-light.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const bounds = await page.locator(".sidebar").boundingBox();
      return bounds ? bounds.x + bounds.width : 0;
    })
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: resolve(evidence, "return-mobile-light.png"),
    fullPage: true,
  });
  await context.clearCookies();
  // The normal four-second job poll receives a real 401 after cookie expiry.
  await expect(
    page.getByRole("alert").filter({ hasText: "세션이 만료" }),
  ).toHaveCount(1, { timeout: 10000 });
  await page.screenshot({
    path: resolve(evidence, "expired-mobile-light.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: resolve(evidence, "expired-desktop-light.png"),
    fullPage: true,
  });
});

test("a second tab changes account and rejects an old open form without a database write", async ({
  page,
  context,
}) => {
  await page.goto(oidcOrigin + "/settings");
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  await page.getByLabel("표시 이름").fill("Alice unsent form");
  const second = await context.newPage();
  let observe!: () => void;
  const observation = new Promise<void>((done) => {
    observe = done;
  });
  // Keep the successful Bob cookie unobserved by the second app until Alice's
  // stale form has exercised the server guard.
  await second.route("**/api/auth/me", async (route) => {
    await observation;
    await route.continue();
  });
  await context.addCookies([
    { name: "oidc_test_account", value: "bob", url: oidcOrigin },
  ]);
  // Direct SSO on the second tab changes the shared HttpOnly cookie. The callback
  // landing is read-only: the first tab still owns its original open form.
  await second.goto(oidcOrigin + "/api/auth/oidc/login?return_to=%2Fsettings");
  await expect(second).toHaveURL(oidcOrigin + "/settings");
  const rejected = page.waitForResponse(
    (r) => r.url().endsWith("/api/profile") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  const response = await rejected;
  expect(response.status()).toBe(409);
  expect(response.request().headers()["x-aag-account"]).toBe("a1-alice");
  await expect(
    (await second.request.get(oidcOrigin + "/api/profile")).json(),
  ).resolves.toMatchObject({ account_name: "bob", display_name: null });
  observe();
  await expect(
    second.getByRole("button", { name: "계정 메뉴: bob" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "계정 메뉴: bob" }),
  ).toBeVisible();
  await expect(page.getByLabel("표시 이름")).toHaveValue("");
});

for (const failure of [403, 503, "network"] as const) {
  test(`read ${failure} offers recovery controls without signing out`, async ({
    page,
  }) => {
    await page.goto(oidcOrigin + "/settings");
    await page.getByRole("link", { name: "SSO로 로그인" }).click();
    await expect(
      page.getByRole("button", { name: "계정 메뉴: alice" }),
    ).toBeVisible();
    let reads = 0;
    await page.route("**/api/scans?**", (route) => {
      reads++;
      return failure === "network"
        ? route.abort("failed")
        : route.fulfill({
            status: failure,
            json: { detail: `Synthetic HTTP ${failure}` },
          });
    });
    await page.getByRole("link", { name: "작업 목록", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      failure === "network" ? "Failed to fetch" : `Synthetic HTTP ${failure}`,
    );
    await expect(
      page.getByRole("button", { name: "계정 메뉴: alice" }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "세션이 만료" }),
    ).toHaveCount(0);
    if (failure === 403) {
      await expect(page.getByRole("alert")).toContainText(
        "권한이 변경되었거나",
      );
      await expect(
        page.getByRole("button", { name: "다시 시도", exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByRole("button", { name: "다시 시도", exact: true }),
      ).toBeVisible();
    }
    if (failure !== "network") {
      await page.screenshot({
        path: resolve(evidence, `read-${failure}-desktop-dark.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(async () => {
          const bounds = await page.locator(".sidebar").boundingBox();
          return bounds ? bounds.x + bounds.width : 0;
        })
        .toBeLessThanOrEqual(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: resolve(evidence, `read-${failure}-mobile-dark.png`),
        fullPage: true,
      });
    }
    await page.unroute("**/api/scans?**");
    if (failure === 403) {
      await page.getByRole("link", { name: "대시보드로 이동" }).click();
      await expect(page).toHaveURL(oidcOrigin + "/");
      await expect(
        page.getByRole("heading", { name: "검사 현황" }),
      ).toBeVisible();
    } else {
      const recovered = page.waitForResponse(
        (response) =>
          response.url().includes("/api/scans?") && response.status() === 200,
      );
      await page
        .getByRole("button", { name: "다시 시도", exact: true })
        .click();
      await recovered;
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page).toHaveURL(oidcOrigin + "/jobs");
      expect(reads).toBe(1);
    }
  });
}

test("retrying a failed read never replays an unsuccessful mutation", async ({
  page,
}) => {
  await page.goto(oidcOrigin + "/settings");
  await page.getByRole("link", { name: "SSO로 로그인" }).click();
  let mutations = 0;
  await page.route("**/api/profile", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    mutations++;
    return route.fulfill({
      status: 503,
      json: { detail: "Synthetic save unavailable" },
    });
  });
  await page.getByLabel("표시 이름").fill("Unsent value");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic save unavailable",
  );
  await expect(
    page.getByRole("button", { name: "다시 시도", exact: true }),
  ).toHaveCount(0);
  await page.route("**/api/scans?**", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic read unavailable" },
    }),
  );
  await page.getByRole("link", { name: "작업 목록", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic read unavailable",
  );
  await page.unroute("**/api/scans?**");
  const recovered = page.waitForResponse(
    (response) =>
      response.url().includes("/api/scans?") && response.status() === 200,
  );
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await recovered;
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(mutations).toBe(1);
});
