import { expect, test, type Page } from "@playwright/test";

const projects = new WeakMap<Page, number>();
const views = ["list", "board", "timeline", "calendar"] as const;
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { email: "admin@example.com", password: "atlas-dev-2026" } })).status()).toBe(200);
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const id = projects.get(page);
  if (id) { await page.goto("about:blank"); expect((await page.request.delete(`/api/projects/${id}`)).ok()).toBeTruthy(); }
});
async function fixture(page: Page, empty = false) {
  const res = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `クイック追加検証 ${Date.now()}` } });
  expect(res.status()).toBe(201); const { id } = await res.json(); projects.set(page, id);
  const sections = await (await page.request.get(`/api/lookup?project_id=${id}`)).json() as { id: number; name: string }[];
  if (empty) for (const section of sections) expect((await page.request.delete(`/api/sections/${section.id}`)).ok()).toBeTruthy();
  return { id, sections: empty ? [] : sections };
}
async function tasks(page: Page, id: number) {
  return (await (await page.request.get(`/api/projects/${id}/export?format=json`)).json()).tasks as { id: number; name: string; section_id: number | null; start_on: string | null; due_on: string | null; is_milestone: boolean }[];
}
async function add(page: Page, view: string) {
  const input = page.getByRole("textbox", { name: "新しいタスク名", exact: true });
  // Wait for hydration using a harmless menu first, never repeat a mutating click.
  await expect(async () => {
    if (!await page.getByRole("menu", { name: "追加の種類" }).isVisible()) await page.getByRole("button", { name: "追加オプション" }).first().click();
    await expect(page.getByRole("menu", { name: "追加の種類" })).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.keyboard.press("Escape");
  await page.locator(`[data-${view}-add]`).click();
  await expect(input).toBeFocused();
  return input;
}
for (const width of [1440, 390]) for (const view of views) test(`${view}: inserts immediately, inline name and persistence at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const f = await fixture(page);
  await page.goto(`/projects/${f.id}?view=${view}`);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/tasks", async route => { if (route.request().method() === "POST") await gate; await route.continue(); });
  const input = await add(page, view);
  try {
    await expect(page.getByRole("dialog", { name: "タスクを追加", exact: true })).toHaveCount(0);
    expect(await tasks(page, f.id)).toHaveLength(0);
    await input.fill("週次レビュー資料を準備");
    await page.screenshot({ path: test.info().outputPath(`${view}-quick-${width}.png`) });
    await input.press("Enter");
  } finally { release(); }
  await expect(input).toHaveCount(0);
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("週次レビュー資料を準備");
  const saved = await tasks(page, f.id); expect(saved).toHaveLength(1);
  expect(saved[0].section_id).toBe(f.sections[0].id);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; });
  if (view === "timeline") {
    expect(saved[0].start_on).toBe(today);
    expect((Date.parse(saved[0].due_on!) - Date.parse(today)) / 86400000).toBe(4);
  } else expect(saved[0].due_on).toBe(view === "calendar" ? today : null);
  await expect(page.locator("[data-task-pane]")).toHaveCount(0);
  await page.reload(); expect(await tasks(page, f.id)).toEqual(saved);
});
for (const view of views) test(`${view}: blank task survives reload without a section`, async ({ page }) => {
  const f = await fixture(page, true); await page.goto(`/projects/${f.id}?view=${view}`);
  const input = await add(page, view);
  await expect.poll(async () => (await tasks(page, f.id)).length).toBe(1);
  await input.press("Escape"); await page.reload();
  expect((await tasks(page, f.id))[0]).toMatchObject({ name: "", section_id: null });
});
test("four menu options create a milestone, section and approval setup", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=list`);
  await expect(async () => { await page.getByRole("button", { name: "追加オプション" }).click(); await expect(page.getByRole("menu")).toBeVisible({ timeout: 500 }); }).toPass();
  await expect(page.getByRole("menuitem")).toHaveText(["○タスク", "✓承認リクエスト", "◇マイルストーン", "☷セクション"]);
  await page.getByRole("menuitem", { name: "マイルストーン" }).click();
  await page.getByRole("textbox", { name: "新しいタスク名", exact: true }).fill("リリース判定");
  await page.getByRole("textbox", { name: "新しいタスク名", exact: true }).press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("リリース判定");
  const id = (await tasks(page, f.id))[0].id;
  await page.reload();
  await expect(page.locator(`[data-list-row="${id}"]`).getByRole("button", { name: "マイルストーンを完了にする" })).toBeVisible();
  await page.getByRole("button", { name: "追加オプション" }).click();
  await page.getByRole("menuitem", { name: "セクション" }).click();
  await page.getByRole("textbox", { name: "新しいセクション名" }).fill("リリース準備");
  await page.getByRole("textbox", { name: "新しいセクション名" }).press("Enter");
  await expect(page.getByRole("textbox", { name: "新しいセクション名" })).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get(`/api/lookup?project_id=${f.id}`)).json()).some((s: { name: string }) => s.name === "リリース準備")).toBe(true);
  await page.getByRole("button", { name: "追加オプション" }).click();
  await page.getByRole("menuitem", { name: "承認リクエスト" }).click();
  await expect(page).toHaveURL(/approval=1/);
  await expect(page.locator("[data-task-pane]")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "承認者", exact: true })).toBeVisible();
});
test("quick blank creation is explicit and failures retain typed text", async ({ page }) => {
  const f = await fixture(page);
  expect((await page.request.post("/api/tasks", { data: { project_id: f.id, name: "" } })).status()).toBe(400);
  expect((await page.request.post("/api/tasks", { data: { project_id: f.id, name: "", quick_add: "yes" } })).status()).toBe(400);
  await page.goto(`/projects/${f.id}?view=board`);
  await page.route("**/api/tasks", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  const input = await add(page, "board"); await input.fill("通信失敗中のアイデア"); await input.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "追加を確認" })).toContainText("追加を確認できませんでした");
  await expect(input).toHaveValue("通信失敗中のアイデア");
  expect(await tasks(page, f.id)).toHaveLength(0);
});
test("timeline creates today even when viewing a historical range", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=timeline&from=2020-01-01`);
  const input = await add(page, "timeline"); await expect(input).toBeInViewport();
  await input.fill("今日からの作業"); await input.press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("今日からの作業");
  expect((await tasks(page, f.id))[0].start_on).not.toBe("2020-01-01");
});
for (const view of views) test(`${view}: new task stays visible under completed-only filtering`, async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=${view}&completed_only=1&completed=done`);
  const input = await add(page, view); await expect(input).toBeInViewport();
  await input.fill("フィルター中に追加"); await input.press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("フィルター中に追加");
});
test("name save failure retries the same task without duplicate creation", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=list`);
  let attempts = 0;
  await page.route("**/api/tasks/*", route => {
    if (route.request().method() === "PATCH" && ++attempts === 1) return route.fulfill({ status: 503, json: { error: "test" } });
    return route.continue();
  });
  const input = await add(page, "list"); await input.fill("再試行で保存"); await input.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "名前を保存できませんでした" })).toBeVisible();
  await expect(input).toHaveValue("再試行で保存");
  await input.press("Enter"); await expect(input).toHaveCount(0);
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("再試行で保存");
  expect(await tasks(page, f.id)).toHaveLength(1);
});
test("calendar returns to today from another month when adding", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=calendar&month=2020-01&weekends=0`);
  const input = await add(page, "calendar"); await expect(input).toBeInViewport();
  await input.fill("今日のアイデア"); await input.press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("今日のアイデア");
  expect(new URL(page.url()).searchParams.get("month")).not.toBe("2020-01");
});
test("viewers cannot quick-create tasks from any view or the API", async ({ page, browser }) => {
  const f = await fixture(page);
  expect((await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } })).status()).toBe(201);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await context.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: "atlas-dev-2026" } })).status()).toBe(200);
    const actor = await context.newPage();
    for (const view of views) {
      await actor.goto(`/projects/${f.id}?view=${view}`);
      await expect(actor.locator(`[data-${view}-add]`)).toBeDisabled();
      await expect(actor.getByRole("button", { name: "追加オプション" }).first()).toBeDisabled();
    }
    expect((await context.request.post("/api/tasks", { data: { project_id: f.id, name: "", quick_add: true } })).status()).toBe(403);
    expect(await tasks(page, f.id)).toHaveLength(0);
  } finally { await context.close(); }
});
test("quick task remains first after persistence without moving existing tasks", async ({ page }) => {
  const f = await fixture(page);
  for (const name of ["既存タスクA", "既存タスクB"]) expect((await page.request.post("/api/tasks", { data: { project_id: f.id, section_id: f.sections[0].id, name } })).status()).toBe(201);
  const before = await tasks(page, f.id);
  await page.goto(`/projects/${f.id}?view=list`);
  const input = await add(page, "list"); await input.fill("先頭のアイデア"); await input.press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("先頭のアイデア");
  await page.reload();
  expect((await tasks(page, f.id)).slice(1)).toEqual(before);
  await expect(page.locator("[data-list-row]").first()).toContainText("先頭のアイデア");
});
