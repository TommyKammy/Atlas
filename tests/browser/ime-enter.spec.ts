import { expect, test, type Locator, type Page } from "@playwright/test";

const projects = new WeakMap<Page, number>();
test.afterEach(async ({ page }, info) => {
  const projectId = projects.get(page);
  if (!projectId) return;
  const response = await page.request.delete(`/api/projects/${projectId}`);
  if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
});

async function fixture(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" } })).status()).toBe(200);
  const project = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `IME Enter ${test.info().testId} ${Date.now()}` } });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  projects.set(page, projectId);
  const created = await page.request.post("/api/tasks", { data: { project_id: projectId, name: "IME task before edit" } });
  expect(created.status()).toBe(201);
  const { id: taskId } = await created.json() as { id: number };
  await page.goto(`/projects/${projectId}?view=list`);
  await expect(page.locator("[data-list-view]")).toBeVisible();
  await page.waitForURL((url) => url.searchParams.get("list_state") === "1");
  return { projectId, taskId };
}

async function confirmComposition(input: Locator, page: Page, key: "Enter" | "Escape" = "Enter") {
  await input.dispatchEvent("compositionstart", { data: "入力" });
  await input.dispatchEvent("keydown", { key, code: key, keyCode: key === "Enter" ? 13 : 27, isComposing: true, bubbles: true });
  await input.dispatchEvent("compositionend", { data: "入力" });
  // Safari-style conversion-confirmation event after compositionend.
  await input.dispatchEvent("keydown", { key, code: key, keyCode: 229, isComposing: false, bubbles: true });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("EV08 search conversion confirmation keeps focus and only the following Enter navigates", async ({ page }) => {
  await fixture(page);
  const before = page.url();
  const input = page.locator("[data-global-search-input]");
  await input.fill("日本語検索を確定");
  await confirmComposition(input, page);
  await expect(input).toBeFocused();
  expect(page.url()).toBe(before);
  await input.press("Enter");
  await page.waitForURL((url) => url.pathname === "/search" && url.searchParams.get("q") === "日本語検索を確定");
});

test("EV08 list and task-pane titles do not save on IME confirmation and save on the next Enter", async ({ page }) => {
  const f = await fixture(page);
  const writes: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(`/api/tasks/${f.taskId}`) && response.request().method() === "PATCH") writes.push(response.status());
  });
  const row = page.locator(`[data-list-row="${f.taskId}"]`);
  await row.getByText("IME task before edit", { exact: true }).click();
  const input = row.getByRole("textbox", { name: "タスク名", exact: true });
  await input.fill("日本語のタスク名");
  await confirmComposition(input, page);
  await expect(input).toBeFocused();
  expect(writes).toEqual([]);
  const saved = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${f.taskId}`) && response.request().method() === "PATCH" && response.status() === 200);
  await input.press("Enter");
  await saved;
  await expect(row.getByText("日本語のタスク名", { exact: true })).toBeVisible();
  await row.focus(); await row.press("Enter");
  const title = page.locator("[data-task-pane]").getByRole("textbox", { name: "タスク名", exact: true });
  await title.fill("詳細画面の日本語名");
  await confirmComposition(title, page);
  await expect(title).toBeFocused();
  expect(writes).toEqual([200]);
  const paneSaved = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${f.taskId}`) && response.request().method() === "PATCH" && response.status() === 200);
  await title.press("Enter"); await paneSaved;
  expect(writes).toEqual([200, 200]);
});

test("EV08 saving a view ignores IME confirmation and persists the next Enter including sort direction", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/projects/${f.projectId}?view=list&sort=name&sortdir=desc&list_state=1`);
  await page.locator("[data-list-options-open]").click();
  await page.getByRole("button", { name: "現在のビューを保存", exact: true }).click();
  const input = page.getByRole("textbox", { name: "保存するビュー名", exact: true });
  await input.fill("日本語の保存ビュー");
  const saves: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/saved-views") && request.method() === "POST") saves.push(request.url()); });
  await confirmComposition(input, page);
  await confirmComposition(input, page, "Escape");
  await expect(input).toBeFocused();
  expect(saves).toEqual([]);
  await input.press("Enter");
  await page.waitForURL((url) => url.searchParams.has("saved"));
  expect(saves).toHaveLength(1);
  await expect(page.locator("[data-list-view]")).toHaveAttribute("data-list-sortdir", "desc");
  const savedViews = await page.request.get(`/api/saved-views?project_id=${f.projectId}`);
  expect(savedViews.status()).toBe(200);
  const saved = (await savedViews.json() as { name: string; filters: { sortdir?: string } }[]).find((view) => view.name === "日本語の保存ビュー");
  expect(saved?.filters.sortdir).toBe("desc");
});


test("EV08 IME confirmation does not create list tasks or sections until a subsequent Enter", async ({ page }) => {
  await fixture(page);
  const taskWrites: number[] = [];
  const sectionWrites: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() !== "POST") return;
    if (response.url().endsWith("/api/tasks")) taskWrites.push(response.status());
    if (response.url().endsWith("/api/sections")) sectionWrites.push(response.status());
  });
  const add = page.locator("[data-section-add-task]").first();
  const sectionId = await add.getAttribute("data-section-add-task");
  await page.locator(`[data-list-section-header][data-section-id="${sectionId}"]`).hover();
  await add.click();
  const taskName = page.locator(`[data-add-task-section="${sectionId}"]`);
  await taskName.fill("日本語タスク作成");
  await confirmComposition(taskName, page);
  await expect(taskName).toBeFocused();
  expect(taskWrites).toEqual([]);
  const taskCreated = page.waitForResponse((response) => response.url().endsWith("/api/tasks") && response.request().method() === "POST" && response.status() === 201);
  await taskName.press("Enter"); await taskCreated;
  await expect(page.locator("[data-list-row]").getByText("日本語タスク作成", { exact: true })).toBeVisible();
  expect(taskWrites).toEqual([201]);
  await page.getByRole("button", { name: "＋ セクションを追加", exact: true }).click();
  const sectionName = page.locator("[data-add-section-input]");
  await sectionName.fill("日本語セクション作成");
  await confirmComposition(sectionName, page);
  await expect(sectionName).toBeFocused();
  expect(sectionWrites).toEqual([]);
  const sectionCreated = page.waitForResponse((response) => response.url().endsWith("/api/sections") && response.request().method() === "POST" && response.status() === 201);
  await sectionName.press("Enter"); await sectionCreated;
  await expect(page.locator("[data-section-name]").filter({ hasText: "日本語セクション作成" })).toBeVisible();
  expect(sectionWrites).toEqual([201]);
});


test("EV08 rich-text comment submission ignores composing Ctrl+Enter", async ({ page }) => {
  const f = await fixture(page);
  const row = page.locator(`[data-list-row="${f.taskId}"]`);
  await row.focus(); await row.press("Enter");
  const editor = page.locator("[data-task-pane] [data-comment-input]");
  await editor.fill("日本語コメントの確定");
  const submissions: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/api/comments") && response.request().method() === "POST") submissions.push(response.status());
  });
  await editor.dispatchEvent("compositionstart", { data: "確定" });
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, ctrlKey: true, isComposing: true, bubbles: true });
  await editor.dispatchEvent("compositionend", { data: "確定" });
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, ctrlKey: true, isComposing: false, bubbles: true });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(submissions).toEqual([]);
  const submitted = page.waitForResponse((response) => response.url().endsWith("/api/comments") && response.request().method() === "POST" && response.status() === 201);
  await editor.press("Control+Enter"); await submitted;
  expect(submissions).toEqual([201]);
});


test("EV08 composing Escape neither blurs a list draft nor closes task details", async ({ page }) => {
  const f = await fixture(page);
  const writes: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(`/api/tasks/${f.taskId}`) && response.request().method() === "PATCH") writes.push(response.status());
  });
  const row = page.locator(`[data-list-row="${f.taskId}"]`);
  await row.getByText("IME task before edit", { exact: true }).click();
  const input = row.getByRole("textbox", { name: "タスク名", exact: true });
  await input.fill("変換を取り消している途中");
  await confirmComposition(input, page, "Escape");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("変換を取り消している途中");
  expect(writes).toEqual([]);
  // Ordinary Escape still cancels the row editor without submitting it.
  await input.press("Escape");
  await expect(row.getByText("IME task before edit", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  await row.focus(); await row.press("Enter");
  const pane = page.locator("[data-task-pane]");
  const title = pane.getByRole("textbox", { name: "タスク名", exact: true });
  await title.fill("詳細の変換取り消し中");
  await confirmComposition(title, page, "Escape");
  await expect(pane).toBeVisible();
  await expect(title).toBeFocused();
  expect(writes).toEqual([]);
  const saved = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${f.taskId}`) && response.request().method() === "PATCH" && response.status() === 200);
  await title.press("Enter"); await saved;
  expect(writes).toEqual([200]);
  await page.keyboard.press("Escape");
  await expect(pane).toHaveCount(0);
  await page.locator("[data-list-filter-open]").click();
  const menu = page.locator("[data-list-filter-menu]");
  const quickFilter = page.locator('[data-list-quick-filter="mine"]');
  await expect(quickFilter).toBeVisible();
  await confirmComposition(menu, page, "Escape");
  await expect(quickFilter).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});
