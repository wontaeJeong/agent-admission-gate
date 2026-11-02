import { expect, test } from "@playwright/test";

for (const [state, message] of [
  ["disabled", "API 키와 도구 연결이 비활성화되어 있습니다."],
  [
    "identity_unconfigured",
    "SSO 계정·그룹 확인이 구성되지 않아 API 키와 도구 연결이 차단되었습니다.",
  ],
] as const) {
  test(`key and device controls explain ${state}`, async ({ page }) => {
    await page.route("**/api/auth/config", async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      await route.fulfill({
        response,
        json: { ...config, api_keys_state: state },
      });
    });
    await page.goto("/login");
    await page.getByLabel("사용자명").fill("admin");
    await page.getByLabel("비밀번호").fill("test-password-long");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "검사 현황" }),
    ).toBeVisible();
    const origin = new URL(page.url()).origin;
    const key = await page.request.post("/api/api-keys", {
      headers: { Origin: origin },
      data: { name: `Cleanup ${state}` },
    });
    expect(key.status()).toBe(201);
    const device = await page.request.post("/api/device-clients", {
      headers: { Origin: origin },
      data: { name: `Cleanup ${state}` },
    });
    expect(device.status()).toBe(201);
    await page.goto("/api-keys");
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByLabel("키 이름")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "발급", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "폐기", exact: true }).first(),
    ).toBeEnabled();
    await page.goto("/device-clients");
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByLabel("도구에 표시된 코드")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "등록", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "비활성화", exact: true }).first(),
    ).toBeEnabled();
  });
}
