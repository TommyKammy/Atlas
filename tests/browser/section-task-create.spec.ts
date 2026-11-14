import { expect, test, type Locator, type Page } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const fixtures = new WeakMap<Page, number>();
type SavedTask = { id: number; name: string; section_id: number | null; due_on: string | null };
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const id = fixtures.get(page);
  if (id) { await page.goto("about:blank"); expect((await page.request.delete(`/api/projects/${id}`)).ok()).toBeTruthy(); }
});
async function tasks(page: Page, id: number): Promise<SavedTask[]> {
  return (await (await page.request.get(`/api/projects/${id}/export?format=json`)).json()).tasks;
}
async function fixture(page: Page) {
  const result = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `セクション内の即時追加 ${Date.now()}` } });
  expect(result.status()).toBe(201); const { id } = await result.json(); fixtures.set(page, id);
  const sections: { id: number; name: string }[] = await (await page.request.get(`/api/lookup?project_id=${id}`)).json();
  for (const [index, name] of ["既存の計画", "既存の進行中タスク"].entries()) {
    expect((await page.request.post("/api/tasks", { data: { project_id: id, section_id: sections[index].id, name } })).status()).toBe(201);
  }
  return { id, sections };
}
async function open(page: Page, id: number, view: string) {
  await page.goto(`/projects/${id}?view=${view}`);
  // Probe hydration without repeating a task-creating action.
  await expect(async () => {
    if (!await page.getByRole("menu", { name: "追加の種類" }).isVisible()) await page.getByRole("button", { name: "追加オプション" }).first().click();
    await expect(page.getByRole("menu", { name: "追加の種類" })).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.keyboard.press("Escape");
}
function section(page: Page, view: string, id: number | null): Locator {
  if (view === "board") return page.locator(`[data-board-column="${id === null ? "s-none" : `s${id}`}"]`);
  return id === null ? page.locator("[data-list-unsectioned]") : page.locator(`[data-list-section-block="${id}"]`);
}
const newName = (root: Locator) => root.getByRole("textbox", { name: "新しいタスク名", exact: true });
for (const width of [1440, 390]) for (const view of ["list", "board"]) test(`${view}: section footer inserts immediately in the clicked section at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const f = await fixture(page); const before = await tasks(page, f.id);
  await open(page, f.id, view);
  const target = section(page, view, f.sections[1].id);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/tasks", async route => { await gate; await route.continue(); });
  try {
    await target.locator("[data-add-task-open]").click();
    const input = newName(target); await expect(input).toBeFocused(); await expect(input).toBeInViewport();
    expect(await tasks(page, f.id)).toEqual(before);
    await expect(page.locator("input[data-add-task]")).toHaveCount(0);
    await expect(page.locator("[data-task-pane]")).toHaveCount(0);
    await input.fill("このセクションで進めるアイデア");
    await page.screenshot({ path: test.info().outputPath(`${view}-section-${width}.png`) });
    await input.press("Enter");
  } finally { release(); }
  await expect(newName(target)).toHaveCount(0);
  await expect.poll(async () => (await tasks(page, f.id)).filter(task => task.name === "このセクションで進めるアイデア").length).toBe(1);
  const saved = await tasks(page, f.id); const created = saved.find(task => !before.some(old => old.id === task.id))!;
  expect(created).toMatchObject({ section_id: f.sections[1].id, name: "このセクションで進めるアイデア", due_on: null });
  expect(saved.filter(task => before.some(old => old.id === task.id))).toEqual(before);
  await page.reload(); await expect(target).toContainText("このセクションで進めるアイデア");
  expect(await tasks(page, f.id)).toEqual(saved);
});
for (const view of ["list", "board"]) test(`${view}: empty section and unsectioned bucket keep their destinations`, async ({ page }) => {
  const f = await fixture(page); await open(page, f.id, view);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/tasks")) posts += 1;
  });
  const empty = section(page, view, f.sections[2].id);
  await empty.locator("[data-add-task-open]").click();
  await expect(newName(empty)).toBeFocused();
  expect(posts).toBe(0);
  expect((await tasks(page, f.id)).filter(t => t.name === "")).toHaveLength(0);
  await newName(empty).press("Escape");
  await expect(newName(empty)).toHaveCount(0);
  expect(posts).toBe(0);
  expect((await page.request.post("/api/tasks", { data: { project_id: f.id, section_id: null, name: "既存のセクションなし" } })).status()).toBe(201);
  await page.reload(); const loose = section(page, view, null);
  await loose.locator("[data-add-task-open]").click(); await expect(newName(loose)).toBeFocused();
  await newName(loose).fill("分類前のアイデア"); await newName(loose).press("Enter");
  await expect.poll(async () => (await tasks(page, f.id)).find(t => t.name === "分類前のアイデア")?.section_id).toBe(null);
  await page.reload(); await expect(loose).toContainText("分類前のアイデア");
});
test("list section header expands the clicked section and creates inline", async ({ page }) => {
  const f = await fixture(page); await open(page, f.id, "list");
  const target = section(page, "list", f.sections[1].id);
  await target.getByRole("button", { name: "折りたたむ", exact: true }).click();
  await expect(target.locator("[data-list-row]")).toHaveCount(0);
  await target.getByRole("button", { name: "このセクションにタスクを追加" }).click();
  await expect(newName(target)).toBeFocused();
  await newName(target).fill("見出しから追加"); await newName(target).press("Tab");
  await expect.poll(async () => (await tasks(page, f.id)).find(t => t.name === "見出しから追加")?.section_id).toBe(f.sections[1].id);
});
for (const view of ["list", "board"]) test(`${view}: delayed save in an earlier section cannot steal the next task's focus`, async ({ page }) => {
  const f = await fixture(page); await open(page, f.id, view);
  const first = section(page, view, f.sections[1].id), second = section(page, view, f.sections[2].id);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let posts = 0;
  await page.route("**/api/tasks", async route => { if (++posts === 1) await gate; await route.continue(); });
  try {
    await first.locator("[data-add-task-open]").click(); await newName(first).fill("先のセクションのアイデア");
    await second.locator("[data-add-task-open]").click(); await expect(newName(second)).toBeFocused();
    await newName(second).fill("次のセクションのアイデア");
  } finally { release(); }
  await expect.poll(async () => (await tasks(page, f.id)).some(t => t.name === "先のセクションのアイデア")).toBe(true);
  await expect(newName(second)).toBeFocused(); await expect(newName(second)).toHaveValue("次のセクションのアイデア");
  await newName(second).press("Enter");
  await expect.poll(async () => (await tasks(page, f.id)).some(t => t.name === "次のセクションのアイデア")).toBe(true);
  const saved = await tasks(page, f.id);
  expect(saved).toHaveLength(4); expect(posts).toBe(2);
  expect(saved.find(t => t.name === "先のセクションのアイデア")?.section_id).toBe(f.sections[1].id);
  expect(saved.find(t => t.name === "次のセクションのアイデア")?.section_id).toBe(f.sections[2].id);
});
for (const view of ["list", "board"]) test(`${view}: failed section creation preserves text and makes no duplicate requests`, async ({ page }) => {
  const f = await fixture(page); await open(page, f.id, view);
  let posts = 0;
  await page.route("**/api/tasks", async route => { posts++; await route.fulfill({ status: 503, json: { error: "test" } }); });
  const target = section(page, view, f.sections[1].id);
  await target.locator("[data-add-task-open]").click(); await newName(target).fill("保存できなかったアイデア");
  await newName(target).press("Enter");
  await expect(target.getByRole("alert")).toContainText("追加を確認できませんでした");
  await expect(newName(target)).toHaveValue("保存できなかったアイデア");
  expect(posts).toBe(1); expect(await tasks(page, f.id)).toHaveLength(2);
});
test("viewer section add buttons are disabled in list and board", async ({ page, browser }) => {
  const f = await fixture(page);
  expect((await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } })).status()).toBe(201);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await context.request.post("/api/auth/login", { data: { ...credentials, email: "tanaka@example.com" } })).status()).toBe(200);
    const actor = await context.newPage();
    for (const view of ["list", "board"]) {
      await actor.goto(`/projects/${f.id}?view=${view}`);
      const buttons = actor.locator("[data-add-task-open]"); expect(await buttons.count()).toBeGreaterThan(0);
      for (const button of await buttons.all()) await expect(button).toBeDisabled();
    }
    expect((await context.request.post("/api/tasks", { data: { project_id: f.id, section_id: f.sections[1].id, name: "viewer attempt" } })).status()).toBe(403);
  } finally { await context.close(); }
});
