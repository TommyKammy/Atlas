import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

test("375px: the mobile bar switches the theme and opens help inside the viewport", async ({ page }) => {
  test.setTimeout(60_000);
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.status()).toBe(200);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const bar = page.locator("[data-mobile-bar]");
  await expect(bar).toBeVisible();

  // Theme switch: the top bar's own toggle follows the page surface tokens.
  const toggle = bar.locator("[data-theme-toggle]");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("data-theme-toggle-variant", "topbar");
  await expect(toggle).toHaveAttribute("data-theme-state", "light");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("data-theme-state", "dark");

  // The choice is persisted for the next page load.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Help opens below the button and stays inside the 375px viewport.
  const help = bar.locator("[data-topbar-help]");
  await expect(help).toBeVisible();
  await help.click();
  const menu = page.locator("[data-sidebar-help-menu]");
  await expect(menu).toBeVisible();
  const [buttonBox, menuBox] = await Promise.all([help.boundingBox(), menu.boundingBox()]);
  expect(buttonBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(buttonBox!.y + buttonBox!.height);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(375);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(812);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await menu.locator("[data-help-new-ui]").click();
  await expect(page).toHaveURL(/\/help#new-ui$/);
  await expect(page.locator('[data-help-section="new-ui"]')).toBeVisible();
});
