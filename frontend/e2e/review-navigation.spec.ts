import { expect, test } from "@playwright/test";

test("a requester can find their own review without reviewer permissions", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        id: "requester",
        name: "Test user",
        role: "user",
        reviewer: false,
        api_key: false,
      },
    }),
  );
  await page.route("**/api/reviews?**", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1 } }),
  );
  await page.goto("/reviews");
  await expect(
    page.getByRole("link", { name: "검토", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "내 요청" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "검토 필요" })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/review-requester.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("메뉴", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "검토", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/review-mobile.png",
    fullPage: true,
  });
});

test("an administrator without reviewer qualification can find the review queue", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        id: "admin",
        name: "Test admin",
        role: "admin",
        reviewer: false,
        api_key: false,
      },
    }),
  );
  await page.route("**/api/reviews?**", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1 } }),
  );
  await page.goto("/reviews");
  await expect(
    page.getByRole("link", { name: "검토", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "검토 필요" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.screenshot({
    path: "test-results/review-admin.png",
    fullPage: true,
  });
});
