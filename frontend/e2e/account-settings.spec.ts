import { expect, test } from "@playwright/test";

test("edit and reset a personal display name without changing account identity", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("사용자명").fill("admin");
  await page.getByLabel("비밀번호").fill("test-password-long");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: /계정 메뉴/ }).click();
  await page.getByRole("menuitem", { name: "사용자 설정" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { name: "사용자 설정" }),
  ).toBeVisible();
  await expect(page.getByText("admin", { exact: true }).first()).toBeVisible();
  await page.getByLabel("표시 이름").fill("테스트 사용자");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(page.getByRole("status")).toContainText("저장");
  await expect(
    page.getByRole("button", { name: "계정 메뉴: 테스트 사용자" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("표시 이름")).toHaveValue("테스트 사용자");
  await expect(
    page.getByRole("button", { name: "계정 메뉴: 테스트 사용자" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/account-settings.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const bounds = await page.locator(".sidebar").boundingBox();
      return bounds ? bounds.x + bounds.width : 0;
    })
    .toBeLessThanOrEqual(0);
  await expect(page.getByLabel("표시 이름")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/account-settings-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "기본 이름 사용" }).click();
  await expect(
    page.getByRole("button", { name: "계정 메뉴: admin" }),
  ).toBeVisible();
});

for (const nextAccount of ["second", "first"]) {
  test(`late save refreshes only its owner after ${nextAccount} signs in`, async ({
    page,
  }) => {
    let account = "first";
    let saved: string | null = null;
    let releaseSave: (() => void) | undefined;
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        json: { id: account, name: account, role: "user", reviewer: false },
      }),
    );
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({ json: { ok: true } }),
    );
    await page.route("**/api/auth/login", (route) => {
      account = nextAccount;
      return route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() === "PUT") {
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        saved = "first nickname";
        await route.fulfill({
          json: {
            account_name: "first",
            display_name: "first nickname",
            role: "user",
            reviewer: false,
          },
        });
      } else {
        await route.fulfill({
          json: {
            account_name: account,
            display_name: account === "first" ? saved : null,
            role: "user",
            reviewer: false,
          },
        });
      }
    });
    await page.goto("/settings");
    await page.getByLabel("표시 이름").fill("first nickname");
    await page.getByRole("button", { name: "변경 사항 저장" }).click();
    await expect(page.getByLabel("표시 이름")).toBeDisabled();
    await page.getByRole("button", { name: /계정 메뉴/ }).click();
    await page.getByRole("menuitem", { name: "로그아웃" }).click();
    await page.getByLabel("사용자명").fill(nextAccount);
    await page.getByLabel("비밀번호").fill("test-password-long");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `계정 메뉴: ${nextAccount}` }),
    ).toBeVisible();
    expect(releaseSave).toBeDefined();
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/profile") && r.request().method() === "PUT",
    );
    releaseSave!();
    await response;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(
      page.getByRole("button", {
        name: `계정 메뉴: ${nextAccount === "first" ? "first nickname" : "second"}`,
      }),
    ).toBeVisible();
  });
}

test("a profile save completed after navigation updates the current sidebar", async ({
  page,
}) => {
  let releaseSave: (() => void) | undefined;
  let saved: string | null = null;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { id: "first", name: "first", role: "user", reviewer: false },
    }),
  );
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() === "PUT") {
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      saved = "first nickname";
      await route.fulfill({
        json: {
          account_name: "first",
          display_name: "first nickname",
          role: "user",
          reviewer: false,
        },
      });
    } else {
      await route.fulfill({
        json: {
          account_name: "first",
          display_name: saved,
          role: "user",
          reviewer: false,
        },
      });
    }
  });
  await page.goto("/settings");
  await page.getByLabel("표시 이름").fill("first nickname");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await page.getByRole("link", { name: "작업 목록", exact: true }).click();
  expect(releaseSave).toBeDefined();
  releaseSave!();
  await expect(
    page.getByRole("button", { name: "계정 메뉴: first nickname" }),
  ).toBeVisible();
});

test("overlapping saves refresh to the last committed value", async ({
  page,
}) => {
  let saved: string | null = null;
  let releaseFirst: (() => void) | undefined;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { id: "first", name: "first", role: "user", reviewer: false },
    }),
  );
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() === "PUT") {
      const value = route.request().postDataJSON().display_name;
      if (value === "older")
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      saved = value;
      await route.fulfill({
        json: {
          account_name: "first",
          display_name: value,
          role: "user",
          reviewer: false,
        },
      });
    } else {
      await route.fulfill({
        json: {
          account_name: "first",
          display_name: saved,
          role: "user",
          reviewer: false,
        },
      });
    }
  });
  await page.goto("/settings");
  await page.getByLabel("표시 이름").fill("older");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await page.getByRole("link", { name: "작업 목록", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "작업 목록", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /계정 메뉴/ }).click();
  await page.getByRole("menuitem", { name: "사용자 설정" }).click();
  await page.getByLabel("표시 이름").fill("newer");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByRole("button", { name: "계정 메뉴: newer" }),
  ).toBeVisible();
  expect(releaseFirst).toBeDefined();
  releaseFirst!();
  await expect(
    page.getByRole("button", { name: "계정 메뉴: older" }),
  ).toBeVisible();
  await expect(page.getByText(/다른 저장이 완료되어/)).toBeVisible();
  await page.getByRole("button", { name: "최신 저장 값 불러오기" }).click();
  await expect(page.getByLabel("표시 이름")).toHaveValue("older");
});

test("a previous save does not erase new unsaved input after returning", async ({
  page,
}) => {
  let saved: string | null = null;
  let releaseFirst: (() => void) | undefined;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { id: "first", name: "first", role: "user", reviewer: false },
    }),
  );
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() === "PUT") {
      const value = route.request().postDataJSON().display_name;
      if (value === "older")
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      saved = value;
    }
    await route.fulfill({
      json: {
        account_name: "first",
        display_name: saved,
        role: "user",
        reviewer: false,
      },
    });
  });
  await page.goto("/settings");
  await page.getByLabel("표시 이름").fill("older");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await page.getByRole("link", { name: "작업 목록", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "작업 목록", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /계정 메뉴/ }).click();
  await page.getByRole("menuitem", { name: "사용자 설정" }).click();
  await page.getByLabel("표시 이름").fill("unsaved draft");
  expect(releaseFirst).toBeDefined();
  releaseFirst!();
  await expect(page.getByText(/다른 저장이 완료되어/)).toBeVisible();
  await expect(page.getByLabel("표시 이름")).toHaveValue("unsaved draft");
  await expect(
    page.getByRole("button", { name: "변경 사항 저장" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "내 입력 유지하고 계속" }).click();
  await expect(page.getByLabel("표시 이름")).toHaveValue("unsaved draft");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByRole("button", { name: "계정 메뉴: unsaved draft" }),
  ).toBeVisible();
});
