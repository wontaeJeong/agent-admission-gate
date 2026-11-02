import { expect, test, type Page } from "@playwright/test";

async function mockActivity(page: Page, reviewer: boolean) {
  const scanRequests: URLSearchParams[] = [];
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        id: "demo-user",
        name: "Demo user",
        role: reviewer ? "user" : "admin",
        reviewer,
        api_key: false,
      },
    }),
  );
  await page.route("**/api/metrics?*", (route) =>
    route.fulfill({
      json: {
        total_scans: 26,
        pending_reviews: 1,
        oldest_review_seconds: 3600,
        api: { requests: 0, errors: 0 },
        distribution: {},
        statuses: { FAILED: 26 },
        series: [],
        recent: [{ id: "sample-1", source: "sample-repo", status: "FAILED" }],
      },
    }),
  );
  await page.route("**/api/scans?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    scanRequests.push(params);
    if (!reviewer && params.get("scope") === "review") {
      return route.fulfill({
        status: 403,
        json: { detail: "Reviewer required" },
      });
    }
    const pageNo = Number(params.get("page") || 1);
    return route.fulfill({
      json: {
        items: Array.from({ length: pageNo === 1 ? 25 : 1 }, (_, index) => ({
          id: `sample-${pageNo}-${index}`,
          source: `sample-repo-${pageNo}-${index}`,
          source_type: "git",
          profile: "static",
          status: "FAILED",
          effective_verdict: null,
          created_at: 1792972801,
        })),
        total: 26,
        page: pageNo,
        page_size: 25,
      },
    });
  });
  return scanRequests;
}

test("personal failed scans carry scope and dates through filters, pagination, and reload", async ({
  page,
}) => {
  const requests = await mockActivity(page, false);
  await page.goto("/");
  const failed = page.getByRole("link", { name: /건의 검사 실행 실패/ });
  await expect(failed).toHaveAttribute("href", /scope=all/);
  await page.getByLabel("조회 범위").selectOption("personal");
  await page.getByRole("button", { name: "7일", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /건의 검토가 대기/ }),
  ).toHaveAttribute("href", "/reviews?tab=mine&status=pending");
  await expect(failed).toHaveAttribute("href", /scope=personal/);
  await expect(failed).toHaveAttribute("href", /days=7/);
  await failed.click();
  await expect(page).toHaveURL(/\/jobs\?/);
  await expect(page.getByRole("heading", { name: "작업 목록" })).toBeVisible();
  await expect(page.getByLabel("조회 범위")).toHaveValue("personal");
  await expect(page.getByLabel("조회 기간")).toHaveValue("7");
  await expect(page.getByLabel("실행 상태")).toHaveValue("FAILED");
  await expect(page.getByText("sample-repo-1-0")).toBeVisible();
  await expect.poll(() => requests.at(-1)?.get("scope")).toBe("personal");
  expect(requests.at(-1)?.get("days")).toBe("7");
  expect(requests.at(-1)?.get("status")).toBe("FAILED");
  await page.screenshot({ path: "test-results/scans-personal-desktop.png" });
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("sample-repo-2-0")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("조회 범위")).toHaveValue("personal");
  await expect(page.getByLabel("조회 기간")).toHaveValue("7");
  await expect(page.getByText("sample-repo-2-0")).toBeVisible();
  await page.getByLabel("대상 검색").fill("sample");
  await expect(page).toHaveURL(/page=1/);
  await expect(page).toHaveURL(/scope=personal/);
  await expect(page).toHaveURL(/days=7/);
  await expect(page).toHaveURL(/status=FAILED/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "test-results/scans-personal-mobile.png",
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/");
  await page.getByLabel("조회 범위").selectOption("personal");
  await page.getByRole("button", { name: "7일", exact: true }).click();
  const viewAll = page.getByRole("link", { name: /전체 보기/ });
  await expect(viewAll).toHaveAttribute("href", /scope=personal/);
  await expect(viewAll).toHaveAttribute("href", /days=7/);
  await viewAll.click();
  await expect(page.getByLabel("실행 상태")).toHaveValue("");
});

test("review scope opens the reviewed population and role options remain clear", async ({
  page,
}) => {
  await mockActivity(page, true);
  await page.goto("/");
  await expect(page.getByLabel("조회 범위")).toHaveValue("review");
  await expect(
    page.getByRole("link", { name: /건의 검토가 대기/ }),
  ).toHaveAttribute("href", "/reviews?tab=pending");
  await page.getByRole("link", { name: /건의 검사 실행 실패/ }).click();
  await expect(page).toHaveURL(/\/jobs\?/);
  await expect(page.getByRole("heading", { name: "작업 목록" })).toBeVisible();
  await expect(page.getByLabel("조회 범위")).toHaveValue("review");
  await expect(page.getByLabel("조회 기간")).toHaveValue("30");
  await expect(page.getByLabel("실행 상태")).toHaveValue("FAILED");
  await page.screenshot({ path: "test-results/scans-review-desktop.png" });
  await page.getByLabel("실행 상태").selectOption("");
  await expect(page).toHaveURL(/scope=review/);
  await expect(page).toHaveURL(/days=30/);
  await page.getByLabel("조회 범위").selectOption("all");
  await expect(page).toHaveURL(/scope=all/);
  await expect(page).toHaveURL(/days=30/);
});

test("an unqualified admin sees an error for a review deep link and can recover", async ({
  page,
}) => {
  await mockActivity(page, false);
  await page.goto("/jobs?scope=review&days=7");
  await expect(page.getByRole("alert")).toContainText("Reviewer required");
  await expect(page.getByLabel("조회 범위")).toHaveValue("review");
  await page.getByLabel("조회 범위").selectOption("personal");
  await expect(page.getByText("sample-repo-1-0")).toBeVisible();
  await expect(page).toHaveURL(/scope=personal/);
  await expect(page).toHaveURL(/days=7/);
});
