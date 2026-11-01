import { expect, test } from "@playwright/test";

test("account menu offers theme and settings with keyboard access", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("사용자명").fill("admin");
  await page.getByLabel("비밀번호").fill("test-password-long");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  const trigger = page.getByRole("button", { name: /계정 메뉴/ });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: /라이트 모드/ }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: /라이트 모드/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: /화면 설정/ })).toBeVisible();
  await page.screenshot({
    path: "test-results/account-menu.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("메뉴", { exact: true }).click();
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: /다크 모드/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /화면 설정/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Teal" })).toBeVisible();
  const bounds = await page
    .getByRole("menuitemradio", { name: "Teal" })
    .boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/account-menu-mobile.png",
    fullPage: true,
  });
  await page.getByRole("menuitemradio", { name: "Teal" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "teal");
  await trigger.click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("link", { name: "로그인", exact: true }),
  ).toBeVisible();
});
