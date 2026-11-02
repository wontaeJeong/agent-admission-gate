import { expect, test, type Locator } from "@playwright/test";

async function waitForChart(panel: Locator) {
  let previous = -1,
    stable = 0;
  await expect
    .poll(
      async () => {
        const height =
          (
            await panel
              .locator(".recharts-bar-rectangle path")
              .last()
              .boundingBox()
          )?.height ?? 0;
        stable =
          height > 0 && Math.abs(height - previous) < 0.01 ? stable + 1 : 0;
        previous = height;
        return stable;
      },
      { intervals: [100, 100, 100, 200], timeout: 5000 },
    )
    .toBeGreaterThanOrEqual(3);
}

test("HTTP usage separates MCP transport, legacy records and scoped activity", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("사용자명").fill("admin");
  await page.getByLabel("비밀번호").fill("test-password-long");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "검사 현황" })).toBeVisible();

  const allBefore = await (
    await page.request.get("/api/metrics?scope=all")
  ).json();
  const personalBefore = await (
    await page.request.get("/api/metrics?scope=personal")
  ).json();
  expect(allBefore.mcp_http_observed_since).toBeGreaterThan(0);
  const keyName = `usage browser test ${Date.now()}`;
  const keyResponse = await page.request.post("/api/api-keys", {
    headers: { Origin: new URL(page.url()).origin },
    data: { name: keyName },
  });
  expect(keyResponse.status()).toBe(201);
  const { token } = await keyResponse.json();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json, text/event-stream",
  };
  const initialize = await page.request.post("/mcp/", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "browser-test", version: "1" },
      },
    },
  });
  const list = await page.request.post("/mcp/", {
    headers,
    data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  const toolError = await page.request.post("/mcp/", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_scan", arguments: { scan_id: "missing" } },
    },
  });
  const denied = await page.request.post("/mcp/", {
    headers: { Authorization: "Bearer invalid-test-key" },
  });
  expect([
    initialize.status(),
    list.status(),
    toolError.status(),
    denied.status(),
  ]).toEqual([200, 200, 200, 401]);

  await page.goto("/");
  await page.getByRole("tab", { name: "사용량 · 분포" }).click();
  const panel = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "기록된 HTTP 요청" }),
  });
  await expect(panel).toContainText(
    `MCP HTTP · 기록된 요청: ${allBefore.mcp.requests + 4} · HTTP 오류: ${allBefore.mcp.errors + 1}`,
  );
  await expect(panel).toContainText(
    "MCP 도구 오류도 HTTP 200으로 응답할 수 있습니다",
  );
  await expect(panel).toContainText(
    `이전의 일부 도구 호출 ${allBefore.legacy_mcp_tool_calls}건은 HTTP 요청에서 제외됩니다`,
  );
  await expect(panel).toContainText("첫날은 부분 집계입니다");
  await expect(panel).toContainText("이전 날짜는 알 수 없");
  await waitForChart(panel);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "test-results/http-usage-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.getByLabel("조회 범위").selectOption("personal");
  await expect(panel).toContainText(
    `MCP HTTP · 기록된 요청: ${personalBefore.mcp.requests + 3} · HTTP 오류: ${personalBefore.mcp.errors}`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toBeVisible();
  await waitForChart(panel);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/http-usage-mobile.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/api-keys");
  const card = page.locator("article.key-card").filter({ hasText: keyName });
  await expect(card).toContainText("30일 HTTP 사용량");
  await expect(card).toContainText("3요청");
  await expect(
    page.getByText("키 사용량은 REST 및 MCP HTTP 요청입니다", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/http-key-usage.png",
    fullPage: true,
  });
});
