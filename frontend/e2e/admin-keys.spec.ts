import { expect, test } from "@playwright/test";

test("administrators search, inspect and revoke keys with recorded evidence", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("aag-lang", "en"));
  await page.goto("/login");
  await page.getByLabel("사용자명").fill("admin");
  await page.getByLabel("비밀번호").fill("test-password-long");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Admission overview" }),
  ).toBeVisible();

  const prefix = `Synthetic ${Date.now()}`;
  let token = "";
  for (let i = 0; i < 22; i++) {
    const response = await page.request.post("/api/api-keys", {
      headers: { Origin: new URL(page.url()).origin },
      data: { name: `${prefix} agent ${String(i).padStart(2, "0")}` },
    });
    expect(response.status()).toBe(201);
    const created = await response.json();
    if (i === 0) token = created.token;
  }
  const usage = await page.request.get("/api/scans", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(usage.status()).toBe(200);

  await page.goto("/admin?tab=keys");
  await page.getByLabel("Search keys").fill(prefix);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("22 results")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await page.screenshot({
    path: "test-results/admin-keys-list.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(`${prefix} agent 00`)).toBeVisible();
  await page.getByLabel("Search keys").fill(`${prefix} agent 00`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("1 results")).toBeVisible();
  await page
    .getByRole("button", { name: `View details for ${prefix} agent 00` })
    .click();
  await expect(
    page.getByRole("heading", { name: `${prefix} agent 00` }),
  ).toBeVisible();
  await expect(page.getByText("Recorded calls", { exact: true })).toBeVisible();
  await expect(
    page.getByText("/api/scans", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Key created")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Recorded calls table" }),
  ).toHaveAttribute("tabindex", "0");
  await page.screenshot({
    path: "test-results/admin-key-detail.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await page.locator(".sidebar").boundingBox();
      return box ? Math.round(box.x + box.width) : 0;
    })
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "test-results/admin-key-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Revoke key", exact: true }).click();
  await page.screenshot({
    path: "test-results/admin-key-confirm.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByLabel("Revocation reason")
    .fill("Synthetic rotation completed");
  await page.getByRole("button", { name: "Confirm revocation" }).click();
  await expect(page.getByText("Synthetic rotation completed")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Key revoked." }),
  ).toBeVisible();
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to keys" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: `${prefix} agent 00` }),
  ).toContainText("revoked");
  await page.getByLabel("State").selectOption("revoked");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(`${prefix} agent 00`)).toBeVisible();
});
