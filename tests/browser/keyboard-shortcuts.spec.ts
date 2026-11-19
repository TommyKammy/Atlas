import { expect, test, type Locator, type Page } from "@playwright/test";

const projects = new WeakMap<Page, number>();

test.afterEach(async ({ page }, info) => {
  const projectId = projects.get(page);
  if (!projectId) return;
  const response = await page.request.delete(`/api/projects/${projectId}`);
  if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
});

async function fixture(page: Page) {
  expect((await page.request.post("/api/auth/login", {
    data: { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" },
  })).status()).toBe(200);
  const prefix = `Keyboard ${test.info().testId} ${Date.now()}`;
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: prefix },
  });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  projects.set(page, projectId);
  const names: string[] = [];
  const taskIds: number[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const name = `${prefix} task ${index}`;
    const created = await page.request.post("/api/tasks", { data: { project_id: projectId, name } });
    expect(created.status()).toBe(201);
    const { id } = await created.json() as { id: number };
    names.push(name);
    taskIds.push(id);
  }
  await page.goto(`/projects/${projectId}?view=list`);
  await expect(page.locator("[data-list-view]")).toBeVisible();
  await page.waitForURL((url) => url.searchParams.get("list_state") === "1");
  return { projectId, taskIds, names };
}

/** Send a key the way Safari confirms a Japanese conversion. */
async function composeKey(target: Locator, page: Page, key: string, code: string, keyCode: number) {
  await target.dispatchEvent("compositionstart", { data: "変換" });
  await target.dispatchEvent("keydown", { key, code, keyCode, isComposing: true, bubbles: true });
  await target.dispatchEvent("compositionend", { data: "変換" });
  await target.dispatchEvent("keydown", { key, code, keyCode: 229, isComposing: false, bubbles: true });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("? opens the shortcut dialog and g b switches the view", async ({ page }) => {
  const f = await fixture(page);
  const dialog = page.getByRole("dialog", { name: "キーボードショートカット" });
  const rows = page.locator("[data-list-row]");

  await page.keyboard.press("?");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "閉じる", exact: true }).first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await rows.first().focus();
  await page.keyboard.press("?");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(rows.first()).toBeFocused();

  await page.keyboard.press("g");
  await page.keyboard.press("b");
  await page.waitForURL((url) => url.pathname === `/projects/${f.projectId}` && url.searchParams.get("view") === "board");
});

test("j and k move focus between list rows", async ({ page }) => {
  await fixture(page);
  const rows = page.locator("[data-list-row]");
  await expect(rows).toHaveCount(3);

  await rows.nth(0).focus();
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.nth(1)).toBeFocused();

  await rows.nth(2).focus();
  await page.keyboard.press("j");
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.nth(1)).toBeFocused();

  // Arrow keys keep their existing behavior alongside j/k.
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(1)).toBeFocused();
});

test("typing in a row input, the description editor and a combobox never runs single-key shortcuts", async ({ page }) => {
  const f = await fixture(page);
  const startUrl = page.url();
  const help = page.getByRole("dialog", { name: "キーボードショートカット" });

  const row = page.locator(`[data-list-row="${f.taskIds[0]}"]`);
  await row.getByText(f.names[0], { exact: true }).click();
  const nameInput = row.getByRole("textbox", { name: "タスク名", exact: true });
  await expect(nameInput).toBeFocused();
  await nameInput.pressSequentially("gb?nj");
  await expect(nameInput).toHaveValue("gb?nj");
  await expect(nameInput).toBeFocused();
  expect(page.url()).toBe(startUrl);
  await expect(help).toHaveCount(0);
  await nameInput.press("Escape");

  await row.focus();
  await row.press("Enter");
  const pane = page.locator("[data-task-pane]");
  await expect(pane).toBeVisible();
  const paneUrl = page.url();
  const description = pane.locator("[data-task-description]");
  await description.getByRole("button", { name: "このタスクの内容を入力します", exact: true }).click();
  const editor = description.getByRole("textbox", { name: "説明", exact: true });
  await expect(editor).toBeFocused();
  await editor.pressSequentially("gb?nj");
  await expect(editor).toContainText("gb?nj");
  await expect(editor).toBeFocused();
  expect(page.url()).toBe(paneUrl);
  await expect(help).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "コマンドパレット" });
  const search = palette.getByRole("combobox", { name: "コマンドを検索" });
  await expect(search).toBeFocused();
  const paletteUrl = page.url();
  await search.pressSequentially("gb?nj");
  await expect(search).toHaveValue("gb?nj");
  await expect(search).toBeFocused();
  expect(page.url()).toBe(paletteUrl);
  await expect(help).toHaveCount(0);
});

test("IME composing g b ? and j neither navigates nor moves row focus", async ({ page }) => {
  await fixture(page);
  const before = page.url();
  const help = page.getByRole("dialog", { name: "キーボードショートカット" });
  const body = page.locator("body");

  await composeKey(body, page, "g", "KeyG", 71);
  await composeKey(body, page, "b", "KeyB", 66);
  await composeKey(body, page, "?", "Slash", 191);
  await composeKey(body, page, "j", "KeyJ", 74);
  expect(page.url()).toBe(before);
  await expect(help).toHaveCount(0);

  // Ordinary presses still work after the composition ends.
  await page.keyboard.press("?");
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  const rows = page.locator("[data-list-row]");
  await rows.nth(0).focus();
  await composeKey(rows.nth(0), page, "j", "KeyJ", 74);
  await expect(rows.nth(0)).toBeFocused();
  await composeKey(rows.nth(0), page, "k", "KeyK", 75);
  await expect(rows.nth(0)).toBeFocused();
  await composeKey(rows.nth(0), page, "g", "KeyG", 71);
  await composeKey(rows.nth(0), page, "b", "KeyB", 66);
  expect(page.url()).toBe(before);
  await expect(rows.nth(0)).toBeFocused();

  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
});
