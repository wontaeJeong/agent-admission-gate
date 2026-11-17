import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { startOidcFixture } from "./oidcFixture";
test.use({ ignoreHTTPSErrors: true });
let provider: Awaited<ReturnType<typeof startOidcFixture>>;
test.beforeEach(async () => {
  provider = await startOidcFixture();
});
test.afterEach(async () => {
  await provider.stop();
});
const id = "a1-synthetic-job";
const first = {
  fingerprint: "duplicate",
  engine: "builtin",
  rule: "RULE-1",
  severity: "high",
  title: "First duplicate",
  path: "first.py",
  line: 1,
  action: "security",
  evidence: "First evidence",
  remediation: "Review first",
  suppressed: false,
};
const second = {
  ...first,
  severity: "low",
  engine: "secondary",
  title: "Second duplicate",
  path: "second.py",
  evidence: "Second evidence",
};
async function mockFindings(
  page: Page,
  findings = [
    first,
    { ...first, fingerprint: "other", title: "Other finding" },
    second,
  ],
) {
  await page.route(`**/api/scans/${id}`, async (route) => {
    const response = await page.request.get(
      provider.origin + `/api/scans/${id}`,
    );
    const job = await response.json();
    await route.fulfill({
      json: {
        ...job,
        result: {
          ...job.result,
          findings,
        },
      },
    });
  });
}
async function login(page: Page, path: string) {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto(provider.origin + path);
  await page
    .getByRole("link", { name: "Sign in with SSO", exact: true })
    .click();
  await expect(page.locator(".login-page")).toHaveCount(0);
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  const dir = resolve(
    import.meta.dirname,
    "../../docs/engineering/screenshots/convenience-e1",
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
test("login returns to exact duplicate occurrence and polling retains URL filters", async ({
  page,
}) => {
  await mockFindings(page);
  const path = `/jobs/${id}?tab=findings&finding=duplicate&occurrence=1&severity=high&engine=builtin&q=First`;
  await login(page, path);
  await expect(page).toHaveURL(provider.origin + path);
  await expect(page.locator(".finding-detail h2")).toHaveText(
    "Second duplicate",
  );
  await expect(
    page.getByText("Linked finding is outside the filters.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Finding search", { exact: true })).toHaveValue(
    "First",
  );
  await page.waitForResponse(
    (r) => r.url() === provider.origin + `/api/scans/${id}`,
  );
  await expect(page.locator(".finding-detail h2")).toHaveText(
    "Second duplicate",
  );
  await expect(page).toHaveURL(provider.origin + path);
  await capture(page, "duplicate-filter-excluded-desktop-dark");
  await page.getByRole("tab", { name: "Admission", exact: true }).click();
  await page.getByRole("tab", { name: "Findings", exact: true }).click();
  await expect(page.locator(".finding-detail h2")).toHaveText(
    "Second duplicate",
  );
  expect(new URL(page.url()).searchParams.get("severity")).toBe("high");
  await page
    .getByRole("button", { name: "Reset finding filters", exact: true })
    .click();
  await expect(page.locator(".finding-list button.selected")).toContainText(
    "Second duplicate",
  );
  expect(new URL(page.url()).searchParams.get("occurrence")).toBe("1");
  await page
    .locator(".finding-list button")
    .filter({ hasText: "First duplicate" })
    .click();
  expect(new URL(page.url()).searchParams.get("occurrence")).toBe("0");
  await capture(page, "duplicate-selected-desktop-dark");
});
test("missing and malformed selection never silently choose a different finding", async ({
  page,
}) => {
  await mockFindings(page);
  await login(page, `/jobs/${id}?tab=findings&finding=missing&occurrence=0`);
  await expect(
    page.getByText("This item cannot be found in this result.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".finding-detail")).toHaveCount(0);
  await expect(page.locator(".finding-list button.selected")).toHaveCount(0);
  await capture(page, "missing-selection-desktop-dark");
  for (const query of [
    "finding=duplicate&occurrence=abc",
    "finding=duplicate",
    "occurrence=0",
    "finding=duplicate&occurrence=0&occurrence=1",
  ]) {
    await page.goto(provider.origin + `/jobs/${id}?tab=findings&${query}`);
    await expect(
      page.getByText("This item cannot be found in this result.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".finding-detail")).toHaveCount(0);
  }
});
test("mobile tools copy exact link, report copy failure and download Markdown", async ({
  page,
}) => {
  await mockFindings(page);
  await login(page, `/jobs/${id}?tab=findings&finding=duplicate&occurrence=1`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).copied = text;
        },
      },
    }),
  );
  await page.getByText("Detail tools", { exact: true }).click();
  await page
    .getByRole("button", { name: "Copy finding link", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).copied)).toBe(
    provider.origin + `/jobs/${id}?tab=findings&finding=duplicate&occurrence=1`,
  );
  await page
    .getByRole("button", { name: "Copy verdict summary", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copied))
    .toContain("Scan summary");
  await expect(page.getByText("Copied.", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Markdown", exact: true })
    .click();
  expect((await downloadPromise).suggestedFilename()).toBe(`scan-${id}.md`);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: "Copy finding link", exact: true })
    .click();
  await expect(
    page.getByText("Copy failed. Try again or download Markdown.", {
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, "sharing-mobile-dark");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Account menu: alice", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Display settings", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "한국어", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "발견 링크 복사", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("발견 검색", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "발견 링크 복사", exact: true })
    .click();
  await expect(
    page.getByText(
      "복사하지 못했습니다. 다시 시도하거나 Markdown을 내려받으세요.",
      { exact: true },
    ),
  ).toBeVisible();
  await capture(page, "sharing-mobile-ko-dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("authenticated summary uses safe Markdown and print CSS with source navigation", async ({
  page,
}) => {
  await login(page, `/jobs/${id}/summary`);
  await expect(
    page.getByRole("heading", {
      name: "검사 요약 / Scan summary",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".scan-summary")).toContainText(
    "Original verdict: BLOCK",
  );
  await expect(page.locator(".scan-summary")).toContainText(
    "Coverage: incomplete",
  );
  await expect(page.locator(".scan-summary")).toContainText(
    "Synthetic finding for login return",
  );
  await expect(page.locator(".scan-summary")).toContainText(
    "Read-only summary",
  );
  await capture(page, "summary-desktop-dark");
  await page.evaluate(() => {
    window.print = () => {
      (window as any).printed = true;
    };
  });
  await page.getByRole("button", { name: "Print", exact: true }).click();
  expect(await page.evaluate(() => (window as any).printed)).toBe(true);
  await page
    .getByRole("button", { name: "Account menu: alice", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Display settings", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "한국어", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "판정 요약 복사", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await capture(page, "summary-desktop-ko-light");
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".scan-summary code").first()).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".summary-tools:visible")).toHaveCount(0);
  await expect(page.locator(".scan-summary")).toBeVisible();
  await capture(page, "summary-print");
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await capture(page, "summary-mobile-light");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "검사로 돌아가기", exact: true })
    .click();
  await expect(page).toHaveURL(provider.origin + `/jobs/${id}`);
});
test("summary denies another account and retries transient read failures", async ({
  page,
}) => {
  await login(page, `/jobs/${id}/summary`);
  await expect(page.locator(".scan-summary")).toBeVisible();
  let failed = true;
  await page.route(`**/api/scans/${id}/summary?format=markdown`, (route) =>
    failed
      ? route.fulfill({
          status: 503,
          json: { detail: "Synthetic unavailable" },
        })
      : route.continue(),
  );
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Synthetic unavailable" }),
  ).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".scan-summary")).toBeVisible();
  await page.context().clearCookies();
  await page
    .context()
    .addCookies([
      { name: "oidc_test_account", value: "bob", url: provider.origin },
    ]);
  await page.reload();
  await page
    .getByRole("link", { name: "Sign in with SSO", exact: true })
    .click();
  await expect(page.getByText("Scan not found", { exact: true })).toBeVisible();
  await expect(page.locator(".scan-summary")).toHaveCount(0);
});

test("literal finding queries all and allow survive sequential typing and URL updates", async ({
  page,
}) => {
  await mockFindings(page, [
    { ...first, title: "Allow network access" },
    second,
  ]);
  await login(
    page,
    `/jobs/${id}?tab=findings&finding=duplicate&occurrence=1&severity=high&engine=builtin`,
  );
  const search = page.getByLabel("Finding search", { exact: true });
  for (const [key, value] of [
    ["a", "a"],
    ["l", "al"],
    ["l", "all"],
  ]) {
    await search.pressSequentially(key);
    await expect(search).toHaveValue(value);
  }
  expect(new URL(page.url()).searchParams.get("q")).toBe("all");
  await expect(page.locator(".finding-list")).toContainText(
    "Allow network access",
  );
  await expect(page.locator(".finding-detail h2")).toHaveText(
    "Second duplicate",
  );
  for (const [key, value] of [
    ["o", "allo"],
    ["w", "allow"],
  ]) {
    await search.pressSequentially(key);
    await expect(search).toHaveValue(value);
  }
  expect(new URL(page.url()).searchParams.get("q")).toBe("allow");
  await page.getByLabel("Severity", { exact: true }).selectOption("all");
  await page.getByLabel("Finding engine", { exact: true }).selectOption("all");
  const params = new URL(page.url()).searchParams;
  expect(params.get("q")).toBe("allow");
  expect(params.has("severity")).toBe(false);
  expect(params.has("engine")).toBe(false);
  expect(params.get("finding")).toBe("duplicate");
  expect(params.get("occurrence")).toBe("1");
  await page.waitForResponse(
    (response) => response.url() === provider.origin + `/api/scans/${id}`,
  );
  await expect(search).toHaveValue("allow");
  await page.reload();
  await expect(search).toHaveValue("allow");
  expect(new URL(page.url()).searchParams.get("q")).toBe("allow");
  await expect(page.locator(".finding-detail h2")).toHaveText(
    "Second duplicate",
  );
  await search.fill("");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  await expect(page.locator(".finding-list button.selected")).toContainText(
    "Second duplicate",
  );
});
