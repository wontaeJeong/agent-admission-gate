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
const metadata = (id: string) => ({
  id,
  source: "https://github.com/example/synthetic.git",
  source_type: "git",
  ref: "main",
  resolved_commit: "a".repeat(40),
  target_commit: null,
  profile: "static",
  status: "COMPLETED",
  verdict: "BLOCK",
  effective_verdict: "REVIEW",
  content_hash: "c".repeat(64),
  created_at: 1,
  policy_version: "v1",
  scanner_revision: "r1",
  coverage_complete: false,
  engines: [
    {
      name: "builtin",
      status: "partial",
      required: true,
      engine_version: null,
      database_version: null,
    },
  ],
});
const finding = (line: number, suppressed = false) => ({
  fingerprint: String(line),
  engine: "builtin",
  rule: "synthetic.rule",
  title: "Synthetic finding <script>alert(1)</script>",
  path: "src/example.py",
  line,
  severity: "high",
  suppressed,
});
const evidence = () => ({
  baseline: metadata("old"),
  current: {
    ...metadata("current"),
    profile: "full",
    policy_version: "v2",
    scanner_revision: "r2",
  },
  comparability: {
    same_source: true,
    same_profile: false,
    same_policy: false,
    same_scanner_revision: false,
    coverage_complete: false,
    provenance_known: false,
  },
  summary: {
    persisting: 1,
    moved_candidate: 1,
    new: 1,
    not_observed: 1,
    unmatched: 1,
  },
  items: [
    {
      classification: "moved_candidate",
      baseline_finding: finding(1),
      current_finding: finding(8),
      change_flags: [],
      confidence: "candidate",
    },
    {
      classification: "persisting",
      baseline_finding: finding(2),
      current_finding: finding(2, true),
      change_flags: ["suppression_changed"],
      confidence: "exact",
    },
    {
      classification: "new",
      baseline_finding: null,
      current_finding: finding(9),
      change_flags: [],
      confidence: "unmatched",
    },
    {
      classification: "not_observed",
      baseline_finding: finding(10),
      current_finding: null,
      change_flags: [],
      confidence: "unmatched",
    },
    {
      classification: "unmatched",
      baseline_finding: finding(11),
      current_finding: null,
      change_flags: [],
      confidence: "unmatched",
    },
  ],
});
async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto(provider.origin + "/jobs");
  await page
    .getByRole("link", { name: "Sign in with SSO", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scans", exact: true }),
  ).toBeVisible();
}
async function open(page: Page) {
  await page.goto(provider.origin + "/jobs/current/compare?baseline=old");
}
async function capture(page: Page, name: string) {
  if (process.env.AAG_CAPTURE_EVIDENCE !== "1") return;
  const dir =
    process.env.AAG_CAPTURE_DIR ||
    resolve(
      import.meta.dirname,
      "../../docs/engineering/screenshots/convenience-b3",
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
test("stored comparison distinguishes candidates, suppression and incomplete evidence in both languages", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/scans/current/compare?*", (route) =>
    route.fulfill({ json: evidence() }),
  );
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Scan comparison", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Comparison limitations" }),
  ).toContainText("Engine coverage is incomplete or differs");
  await expect(
    page.getByRole("region", { name: "Comparison limitations" }),
  ).toContainText("Engine or vulnerability database provenance is unreported");
  await expect(
    page.getByRole("table", { name: "Finding comparison" }),
  ).toContainText("Moved candidate");
  await expect(
    page.getByRole("table", { name: "Finding comparison" }),
  ).toContainText("Suppression changed");
  await expect(page.getByText(/An exact fingerprint means/)).toBeVisible();
  await expect(page.getByText(/Unmatched means a unique match/)).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Finding comparison" }),
  ).toContainText("Not observed · remediation requires confirmation");
  await expect(page.locator("main script")).toHaveCount(0);
  await capture(page, "comparison-desktop-dark");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await capture(page, "comparison-desktop-light");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(page, "comparison-mobile-light");
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await capture(page, "comparison-mobile-dark");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Account menu: alice", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Display settings", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "한국어", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "발견 사항 비교" }),
  ).toContainText("이동 후보");
  await expect(
    page.getByRole("table", { name: "발견 사항 비교" }),
  ).toContainText("예외 적용 변경");
  await expect(
    page.getByText(/동일 fingerprint는 저장된 식별자가/),
  ).toBeVisible();
  await expect(page.getByText(/일치 여부 불명은 유일한 대응을/)).toBeVisible();
  await capture(page, "comparison-desktop-ko-dark");
});
test("unlinked ZIP confirmation is explicit and warning persists", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/scans/current/compare?*", (route) => {
    if (!new URL(route.request().url()).searchParams.has("allow_unlinked"))
      return route.fulfill({
        status: 422,
        json: {
          detail: {
            code: "unlinked_zip",
            message: "Unlinked ZIP uploads require explicit confirmation",
          },
        },
      });
    return route.fulfill({
      json: {
        ...evidence(),
        comparability: { ...evidence().comparability, same_source: false },
      },
    });
  });
  await open(page);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Compare unlinked ZIP uploads",
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, "unlinked-confirmation-desktop-dark");
  await page
    .getByRole("button", { name: "Compare unlinked ZIP uploads", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Comparison limitations" }),
  ).toContainText("Source identity is unconfirmed");
  await capture(page, "unlinked-warning-desktop-dark");
});
test("empty and failed comparisons do not create remediation counts", async ({
  page,
}) => {
  await login(page);
  let failed = false;
  await page.route("**/api/scans/current/compare?*", (route) =>
    route.fulfill({
      json: {
        ...evidence(),
        current: {
          ...metadata("current"),
          status: failed ? "FAILED" : "COMPLETED",
        },
        summary: failed
          ? null
          : {
              persisting: 0,
              moved_candidate: 0,
              new: 0,
              not_observed: 0,
              unmatched: 0,
            },
        items: [],
      },
    }),
  );
  await open(page);
  await expect(page.locator(".empty")).toContainText(
    "No stored findings to compare",
  );
  await capture(page, "empty-desktop-dark");
  failed = true;
  await page.reload();
  await expect(
    page.getByText(
      "A scan failed or was cancelled. Only stored metadata is shown.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Finding comparison" }),
  ).toHaveCount(0);
  await capture(page, "failed-desktop-dark");
});
test("denied reads hide both sides; transient read retries without leaking server errors", async ({
  page,
}) => {
  await login(page);
  let status = 503;
  await page.route("**/api/scans/current/compare?*", (route) =>
    route.fulfill({ status, json: { detail: "RAW-PRIVATE-ERROR" } }),
  );
  await open(page);
  await expect(page.getByRole("alert")).toContainText(
    "Comparison could not be loaded",
  );
  await expect(page.locator("main")).not.toContainText("RAW-PRIVATE-ERROR");
  await capture(page, "error-desktop-dark");
  status = 404;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "One or both scans are unavailable",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("mobile comparison tables scroll with keyboard while preserving readable columns", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/scans/current/compare?*", (route) =>
    route.fulfill({ json: evidence() }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const table = page.getByRole("table", { name: "Finding comparison" });
  const scroll = table.locator("..");
  await expect(scroll).toHaveAttribute("tabindex", "0");
  await scroll.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => scroll.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(0);
  expect(
    (await table.getByRole("cell").nth(1).boundingBox())!.width,
  ).toBeGreaterThan(150);
});

test("a delayed old pair cannot replace a new denied route and large results paginate", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let observed!: () => void;
  const requested = new Promise<void>((resolve) => (observed = resolve));
  await page.route("**/api/scans/current/compare?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("baseline_id") === "old"
    ) {
      observed();
      await blocked;
      await route.fulfill({ json: evidence() }).catch(() => {});
    } else
      await route.fulfill({ status: 404, json: { detail: "Scan not found" } });
  });
  await open(page);
  await requested;
  await page.evaluate(() => {
    history.pushState({}, "", "/jobs/current/compare?baseline=hidden");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("alert")).toContainText(
    "One or both scans are unavailable",
  );
  release();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.unroute("**/api/scans/current/compare?*");
  const large = evidence();
  large.items = Array.from({ length: 1000 }, (_, i) => ({
    ...large.items[0],
    baseline_finding: finding(i),
    current_finding: finding(i + 1000),
  }));
  large.summary = {
    persisting: 0,
    moved_candidate: 1000,
    new: 0,
    not_observed: 0,
    unmatched: 0,
  };
  await page.route("**/api/scans/current/compare?*", (route) =>
    route.fulfill({ json: large }),
  );
  await open(page);
  const table = page.getByRole("table", { name: "Finding comparison" });
  await expect(table.getByRole("row")).toHaveCount(51);
  await expect(table).toContainText("src/example.py:0");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(table).toContainText("src/example.py:50");
  await expect(table.getByRole("row")).toHaveCount(51);
});

test("real stored ZIP results require explicit unlinked confirmation without mutating scans", async ({
  page,
}) => {
  await login(page);
  const zip = Buffer.from(
    "UEsDBBQAAAAAADBtYVsAAAAAAAAAAAAAAAAJAAAAcmVhZG1lLm1kUEsBAhQDFAAAAAAAMG1hWwAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS5tZFBLBQYAAAAAAQABADcAAAAnAAAAAAA=",
    "base64",
  );
  async function upload() {
    const response = await page.request.post(
      provider.origin + "/api/scans/upload",
      {
        headers: { Origin: provider.origin, "X-AAG-Account": "a1-alice" },
        multipart: {
          file: { name: "same.zip", mimeType: "application/zip", buffer: zip },
        },
      },
    );
    expect(response.status()).toBe(202);
    const created = await response.json();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                provider.origin + "/api/scans/" + created.id,
              )
            ).json()
          ).status,
      )
      .toBe("COMPLETED");
    return (
      await page.request.get(provider.origin + "/api/scans/" + created.id)
    ).json();
  }
  const baseline = await upload(),
    current = await upload();
  await page.goto(
    provider.origin +
      "/jobs/" +
      current.id +
      "/compare?baseline=" +
      baseline.id,
  );
  await page
    .getByRole("button", { name: "Compare unlinked ZIP uploads", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Comparison limitations" }),
  ).toContainText("Source identity is unconfirmed");
  const after = await (
    await page.request.get(provider.origin + "/api/scans/" + current.id)
  ).json();
  expect(after).toEqual(current);
});

test("comparison categories filter all results before pagination and reset the page", async ({
  page,
}) => {
  await login(page);
  const result = evidence();
  result.items = [
    ...Array.from({ length: 60 }, (_, i) => ({
      ...result.items[1],
      baseline_finding: finding(i),
      current_finding: finding(i),
    })),
    ...Array.from({ length: 60 }, (_, i) => ({
      ...result.items[2],
      current_finding: finding(1000 + i),
    })),
  ];
  result.summary = {
    persisting: 60,
    moved_candidate: 0,
    new: 60,
    not_observed: 0,
    unmatched: 0,
  };
  await page.route("**/api/scans/current/compare?*", (route) =>
    route.fulfill({ json: result }),
  );
  await open(page);
  const limitations = page.getByRole("heading", {
    name: "Comparison limitations",
  });
  const summary = page.getByRole("heading", { name: "Observed changes" });
  const metadataHeading = page.getByRole("heading", {
    name: "Stored scan metadata",
  });
  await expect(limitations).toBeVisible();
  await expect(summary).toBeVisible();
  const order = await page.locator("main h2").allTextContents();
  expect(order.indexOf("Comparison limitations")).toBeLessThan(
    order.indexOf("Observed changes"),
  );
  expect(order.indexOf("Observed changes")).toBeLessThan(
    order.indexOf("Stored scan metadata"),
  );
  await expect(metadataHeading).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /Newly observed.*60/ }).click();
  const table = page.getByRole("table", { name: "Finding comparison" });
  await expect(table).toContainText("src/example.py:1000");
  await expect(table).not.toContainText("src/example.py:0");
  await expect(
    page.getByRole("button", { name: /Newly observed.*60/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("60 results", { exact: true })).toBeVisible();
  if (process.env.AAG_COMPARE_CAPTURE === "1") {
    await page.screenshot({
      path: "/private/tmp/aag-compare-review-dark.png",
      fullPage: false,
      animations: "disabled",
    });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "light"),
    );
    await page.screenshot({
      path: "/private/tmp/aag-compare-review-light.png",
      fullPage: false,
      animations: "disabled",
    });
  }
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Unmatched.*0/ }).click();
  await expect(
    page.getByText("No findings in this category", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /All findings.*120/ }).click();
  await expect(table).toContainText("src/example.py:0");
  await expect(page.getByText("120 results", { exact: true })).toBeVisible();
});

test("focused comparison category survives a desktop and mobile resize", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/scans/current/compare?*", (route) =>
    route.fulfill({ json: evidence() }),
  );
  await open(page);
  const category = page.getByRole("button", { name: /Newly observed.*1/ });
  await category.click();
  await expect(category).toBeFocused();
  await page.setViewportSize({ width: 790, height: 844 });
  await expect(category).toBeFocused();
  await expect(category).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(category).toBeFocused();
  await expect(
    page.getByRole("table", { name: "Finding comparison" }),
  ).toContainText("src/example.py:9");
});
