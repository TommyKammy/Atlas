import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

async function login(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("list rows have no divider between the drag handle and task name", async ({ page }) => {
  await page.goto("/projects/1?view=list");
  const row = page.locator('[data-list-row="1"]');
  await expect(row).toBeVisible();

  const nameCell = row.locator("> div").first();
  const borderLeft = await nameCell.evaluate((element) => getComputedStyle(element).borderLeftWidth);
  expect(borderLeft).toBe("0px");

  const header = page.locator("[data-field-add-button]").locator("..");
  const headerBorder = await header
    .locator("> *")
    .nth(1)
    .evaluate((element) => getComputedStyle(element).borderLeftWidth);
  expect(headerBorder).toBe("0px");
});
