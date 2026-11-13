import { expect, test, type Page } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const fixtures = new WeakMap<Page, number>();
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});
test.afterEach(async ({ page }) => {
  const id = fixtures.get(page);
  if (id) { await page.goto("about:blank"); await page.request.delete(`/api/projects/${id}`); }
});
async function fixture(page: Page, empty = false) {
  const response = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `Toolbar ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const { id } = await response.json(); fixtures.set(page, id);
  const sections = await (await page.request.get(`/api/lookup?project_id=${id}`)).json();
  if (empty) for (const section of sections) expect((await page.request.delete(`/api/sections/${section.id}`)).status()).toBe(200);
  return { id, section: empty ? null : sections[0].id };
}
for (const width of [1440, 390]) test(`project actions align across pages at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: 1000 });
  let anchor: { x: number; y: number } | null = null;
  let taskWidth: number | null = null;
  for (const view of ["list", "board", "timeline", "calendar", "dashboard", "knowledge", "messages", "files", "forms"]) {
    await page.goto(`/projects/1?view=${view}`);
    const toolbar = page.locator("[data-project-view-toolbar]");
    await expect(toolbar).toHaveCount(1);
    const button = toolbar.getByRole("button").first();
    await expect(button).toBeVisible();
    const rect = (await button.boundingBox())!;
    if (!anchor) anchor = rect;
    expect(rect.x, view).toBeCloseTo(anchor.x, 0);
    expect(rect.y, view).toBeCloseTo(anchor.y, 0);
    expect(rect.height, view).toBe(28);
    expect(await button.evaluate(e => getComputedStyle(e).fontSize), view).toBe("12px");
    if (["list", "board", "timeline", "calendar"].includes(view)) {
      if (taskWidth === null) taskWidth = rect.width;
      expect(rect.width, view).toBeCloseTo(taskWidth, 0);
    }
    if (view === "board") await expect(toolbar).not.toContainText(/ボード|件/);
    await page.screenshot({ path: test.info().outputPath(`${view}-${width}.png`) });
  }
  await page.goto("/projects/1?view=messages");
  await page.locator("[data-message-new]").click();
  await expect(page.getByPlaceholder("件名（任意）")).toBeVisible();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.getByPlaceholder("件名（任意）")).toHaveCount(0);
});
for (const mode of ["section", "empty", "assignee"]) test(`board toolbar creates a task and cancels without writing: ${mode}`, async ({ page }) => {
  const f = await fixture(page, mode === "empty");
  await page.goto(`/projects/${f.id}?view=board&group=${mode === "assignee" ? "assignee" : "section"}`);
  const writes: unknown[] = [];
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/tasks") writes.push(r.postDataJSON()); });
  const start = page.locator("[data-board-add]");
  await expect(async () => { await start.click(); await expect(page.locator("[data-add-task]")).toBeFocused({ timeout: 500 }); }).toPass();
  await page.locator("[data-add-task]").fill("キャンセルする草稿");
  await page.keyboard.press("Escape");
  expect(writes).toHaveLength(0);
  await start.click();
  await page.locator("[data-add-task]").fill("ツールバーから追加");
  const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/tasks");
  await page.keyboard.press("Enter");
  expect((await response).status()).toBe(201);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ project_id: f.id, section_id: f.section, name: "ツールバーから追加" });
  await expect(page.locator("[data-board-card]")).toContainText(["ツールバーから追加"]);
});
test("board toolbar keeps failed drafts and prevents viewer writes", async ({ page, browser }) => {
  const f = await fixture(page);
  await page.goto(`/projects/${f.id}?view=board`);
  await expect(async () => { await page.locator("[data-board-add]").click(); await expect(page.locator("[data-add-task]")).toBeVisible({ timeout: 500 }); }).toPass();
  await page.route("**/api/tasks", route => route.request().method() === "POST" ? route.fulfill({ status: 500, json: { error: "保存失敗の検証" } }) : route.continue());
  await page.locator("[data-add-task]").fill("失敗時の草稿"); await page.keyboard.press("Enter");
  await expect(page.getByText("保存失敗の検証", { exact: true })).toBeVisible();
  await expect(page.locator("[data-add-task]")).toHaveValue("失敗時の草稿");
  expect((await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } })).status()).toBe(201);
  const actor = await browser.newContext();
  try {
    expect((await actor.request.post(`${test.info().project.use.baseURL}/api/auth/login`, { data: { ...credentials, email: "tanaka@example.com" } })).status()).toBe(200);
    const view = await actor.newPage(); await view.goto(`${test.info().project.use.baseURL}/projects/${f.id}?view=board`);
    await expect(view.locator("[data-board-add]")).toBeDisabled();
    for (const button of await view.locator("[data-add-task-open]").all()) await expect(button).toBeDisabled();
  } finally { await actor.close(); }
});
