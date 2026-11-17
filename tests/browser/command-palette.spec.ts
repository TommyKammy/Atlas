import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const run = randomUUID().slice(0, 8);
const password = `Atlas-Palette-${run}!`;
const seedAdmin = {
  email: process.env.E2E_EMAIL ?? "admin@example.com",
  password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
};
const accounts = {
  member: { id: 0, name: `palette-member-${run}`, email: `palette-member-${run}@example.test`, role: "member" },
  admin: { id: 0, name: `palette-admin-${run}`, email: `palette-admin-${run}@example.test`, role: "admin" },
};

async function login(request: APIRequestContext, email: string, pw = password) {
  const response = await request.post("/api/auth/login", { data: { email, password: pw } });
  expect(response.status(), `${email} login`).toBe(200);
}

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+K");
  const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox", { name: "コマンドを検索" });
  await expect(input).toBeFocused();
  return { dialog, input };
}

test.beforeAll(async ({ request }) => {
  await login(request, seedAdmin.email, seedAdmin.password);
  for (const account of Object.values(accounts)) {
    const { name, email, role } = account;
    const response = await request.post("/api/admin/users", { data: { name, email, role, password } });
    if (response.status() !== 201) {
      throw new Error(`could not create ${email}: ${response.status()} ${await response.text()}`);
    }
    account.id = (await response.json()).id;
  }
});

test.afterAll(async ({ request }) => {
  await login(request, seedAdmin.email, seedAdmin.password);
  for (const account of Object.values(accounts)) {
    if (!account.id) continue;
    const response = await request.delete(`/api/admin/users/${account.id}`);
    expect(response.status(), `${account.email} delete`).toBe(200);
  }
});

test("opens from the sidebar search button, focuses the search field and restores focus on Escape", async ({ page }) => {
  await login(page.request, seedAdmin.email, seedAdmin.password);
  await page.goto("/");

  const opener = page.locator("[data-sidebar-actions]").getByRole("button", { name: /^検索/ });
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox", { name: "コマンドを検索" });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-controls", "command-palette-listbox");
  await expect(dialog.getByRole("listbox", { name: "コマンド候補" })).toBeVisible();

  await input.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.keyboard.press("ControlOrMeta+K");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  await expect(dialog).toHaveCount(0);
});

test("typing filters navigation and ArrowDown + Enter opens My tasks", async ({ page }) => {
  await login(page.request, seedAdmin.email, seedAdmin.password);
  await page.goto("/");

  const { dialog, input } = await openPalette(page);
  await input.fill("マイ");
  const myTasks = dialog.getByRole("option", { name: "マイタスク", exact: true });
  await expect(myTasks).toBeVisible();
  await input.press("ArrowDown");
  await expect(myTasks).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");

  await expect(page).toHaveURL(/\/my-tasks$/);
  await expect(dialog).toHaveCount(0);
});

test("portfolio entry follows portfolio visibility", async ({ page }) => {
  await login(page.request, accounts.member.email, password);
  await page.goto("/");
  let palette = await openPalette(page);
  await expect(palette.dialog.getByRole("option", { name: "ポートフォリオ", exact: true })).toHaveCount(0);
  await expect(palette.dialog.getByRole("option", { name: "管理", exact: true })).toHaveCount(0);
  await palette.input.press("Escape");
  await expect(palette.dialog).toHaveCount(0);

  await login(page.request, accounts.admin.email, password);
  await page.goto("/");
  palette = await openPalette(page);
  await expect(palette.dialog.getByRole("option", { name: "ポートフォリオ", exact: true })).toBeVisible();
  await expect(palette.dialog.getByRole("option", { name: "管理", exact: true })).toBeVisible();
});

test("IME conversion Enter does not run the selected command", async ({ page }) => {
  await login(page.request, seedAdmin.email, seedAdmin.password);
  await page.goto("/");

  const { dialog, input } = await openPalette(page);
  await input.fill("マイ");
  const myTasks = dialog.getByRole("option", { name: "マイタスク", exact: true });
  await expect(myTasks).toBeVisible();
  await input.press("ArrowDown");
  await expect(myTasks).toHaveAttribute("aria-selected", "true");

  const before = page.url();
  await input.dispatchEvent("compositionstart", { data: "まい" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, isComposing: true, bubbles: true });
  await input.dispatchEvent("compositionend", { data: "マイ" });
  // Safari-style conversion-confirmation event after compositionend.
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: false, bubbles: true });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  expect(page.url()).toBe(before);
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await input.press("Enter");
  await expect(page).toHaveURL(/\/my-tasks$/);
});

test("search suggestions show a seeded task and Enter opens it", async ({ page }) => {
  await login(page.request, seedAdmin.email, seedAdmin.password);
  await page.goto("/");

  const { dialog, input } = await openPalette(page);
  await input.fill("要件");
  const task = dialog.getByRole("option", { name: /要件定義/ }).first();
  await expect(task).toBeVisible();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await task.getAttribute("aria-selected")) === "true") break;
    await input.press("ArrowDown");
  }
  await expect(task).toHaveAttribute("aria-selected", "true");

  await input.press("Enter");
  await page.waitForURL(
    (url) => url.pathname === "/projects/1" && url.searchParams.get("task") === "2",
  );
});
