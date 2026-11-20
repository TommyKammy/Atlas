import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.status()).toBe(200);
});

test("help page keeps the existing anchors and shows the new UI guide", async ({ page }) => {
  await page.goto("/help");

  await expect(page.locator("[data-help-page]")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "ヘルプと始め方" })).toBeVisible();

  for (const id of ["about", "features", "integrations", "videos", "shortcuts", "privacy", "workspaces"]) {
    await expect(page.locator(`[data-help-section="${id}"]`)).toBeVisible();
  }

  const newUi = page.locator('[data-help-section="new-ui"]');
  await expect(newUi).toBeVisible();
  await expect(newUi).toHaveAttribute("id", "new-ui");
  await expect(newUi.getByRole("heading", { level: 2, name: "新しい画面について" })).toBeVisible();
  await expect(newUi.getByRole("heading", { level: 3, name: "サイドバー" })).toBeVisible();
  await expect(newUi.getByRole("heading", { level: 3, name: "テーマ（ライト / ダーク）" })).toBeVisible();
  await expect(newUi.getByRole("heading", { level: 3, name: "検索とコマンドパレット" })).toBeVisible();
  await expect(newUi.getByRole("heading", { level: 3, name: "プロジェクトのタブ" })).toBeVisible();
  await expect(newUi.getByRole("heading", { level: 3, name: "タスク詳細" })).toBeVisible();
  await expect(newUi.getByRole("heading", { level: 3, name: "名前が変わった表示" })).toBeVisible();
});

test("shortcut section lists the shared global and project rows", async ({ page }) => {
  await page.goto("/help");

  const shortcuts = page.locator('[data-help-section="shortcuts"]');
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.getByText("すべての画面", { exact: true })).toBeVisible();
  await expect(shortcuts.getByText("プロジェクト画面", { exact: true })).toBeVisible();
  await expect(shortcuts.getByText("j / k", { exact: true })).toBeVisible();
  await expect(shortcuts.getByText("⌘K / Ctrl+K", { exact: true })).toBeVisible();
  await expect(shortcuts.getByText("⌘Z / Ctrl+Z", { exact: true })).toBeVisible();
});

test("sidebar help menu links to the new UI guide", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-sidebar-help]").click();
  const link = page.locator("[data-help-new-ui]");
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/help#new-ui$/);
  await expect(page.locator('[data-help-section="new-ui"]')).toBeVisible();
});
