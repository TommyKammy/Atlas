import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

test("signed-out screens omit the app shell and signing in restores it", async ({ page }) => {
  test.setTimeout(60_000);

  // Login and invitation acceptance are reachable without a session. Neither
  // may render the sidebar, the narrow-screen bar, or the command palette.
  for (const route of ["/login", "/invite/invalid-e2e-token"]) {
    await page.goto(route);
    await expect(page.locator("[data-sidebar]")).toHaveCount(0);
    await expect(page.locator("[data-mobile-bar]")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "モバイルナビゲーション" })).toHaveCount(0);
    await expect(page.locator("[data-command-palette-open]")).toHaveCount(0);
    await expect(page.locator("[data-sidebar-help], [data-topbar-help]")).toHaveCount(0);
    await expect(page.locator("[data-theme-toggle]")).toHaveCount(0);
  }
  await expect(page.getByRole("heading", { name: "招待を開けませんでした" })).toBeVisible();

  // Sign in through the form rather than the API so the root layout has to
  // re-render when the session appears.
  await page.goto("/login");
  await page.getByPlaceholder("メールアドレス", { exact: true }).fill(EMAIL);
  await page.getByPlaceholder("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-sidebar]")).toBeVisible();
  await expect(page.locator("[data-command-palette-open]").first()).toBeVisible();

  // A signed-in visitor on /login keeps the same shell as before.
  await page.goto("/login");
  await expect(page.getByText("ログイン済みです。", { exact: true })).toBeVisible();
  await expect(page.locator("[data-sidebar]")).toBeVisible();

  // Below the sidebar breakpoint the same app shell shows the mobile bar.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.locator("[data-sidebar]")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "モバイルナビゲーション" })).toBeVisible();

  // Logging out returns to the chrome-free login screen.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "ユーザー設定" }).click();
  await page.locator("[data-user-logout]").click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("[data-login-form]")).toBeVisible();
  await expect(page.locator("[data-sidebar]")).toHaveCount(0);
});
