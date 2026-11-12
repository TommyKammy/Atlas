import { expect, test, type Page } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const projects = new WeakMap<Page, number>();
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await page.goto("about:blank");
  const id = projects.get(page);
  if (id) await page.request.delete(`/api/projects/${id}`);
});
async function fixture(page: Page) {
  const response = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `ゴミ箱検証 ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const { id } = await response.json(); projects.set(page, id);
  const title = `保持するノート ${Date.now()}`;
  const note = await (await page.request.post("/api/knowledge", { data: { project_id: id, title, body: "## 元の日本語\n\n- 履歴も保持" } })).json();
  const rich = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "復元する本文", marks: [{ type: "bold" }] }] }] };
  const current = await (await page.request.patch(`/api/knowledge/${note.id}`, { data: { expected_revision: 0, body_doc: rich } })).json();
  const other = await (await page.request.post("/api/knowledge", { data: { project_id: id, title: "残るノート", body: "そのまま" } })).json();
  return { id, note: current, original: note, other };
}
async function trash(page: Page, note: { id: number; revision: number }) {
  expect((await page.request.delete(`/api/knowledge/${note.id}?revision=${note.revision}`)).status()).toBe(200);
}

for (const width of [1440, 390]) test(`trash and restore preserve the document and history at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const f = await fixture(page);
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await page.getByRole("button", { name: "削除", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("本文と保存履歴は保持");
  await dialog.getByRole("button", { name: "ゴミ箱に移す", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "ゴミ箱に移しました" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "残るノート", exact: true })).toBeVisible();
  expect((await page.request.get(`/api/knowledge/${f.note.id}`)).status()).toBe(404);
  await page.getByRole("button", { name: "ゴミ箱", exact: true }).click();
  await expect(page.locator("[data-knowledge-trash]")).toContainText(f.note.title);
  await page.screenshot({ path: test.info().outputPath(`trash-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: `「${f.note.title}」を復元`, exact: true }).click();
  await expect(page.getByRole("heading", { name: f.note.title, exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`restored-${width}.png`), fullPage: true });
  const restored = await (await page.request.get(`/api/knowledge/${f.note.id}`)).json();
  expect(restored).toMatchObject({ id: f.note.id, title: f.note.title, body: f.note.body, body_doc: f.note.body_doc, created_at: f.note.created_at, updated_at: f.note.updated_at, revision: f.note.revision + 2 });
  const notes = await (await page.request.get(`/api/knowledge?project_id=${f.id}`)).json();
  expect(notes.map((n: { id: number }) => n.id)).toEqual([f.other.id, f.note.id]);
  await page.reload();
  await expect(page.getByRole("heading", { name: f.note.title, exact: true })).toBeVisible();
  const history = await (await page.request.get(`/api/knowledge/${f.note.id}?history=1`)).json();
  expect(history.some((r: { revision: number }) => r.revision === 0)).toBe(true);
  const original = await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: restored.revision, restore_revision: 0 } });
  expect(original.status()).toBe(200); expect(await original.json()).toMatchObject({ body: f.original.body, body_doc: null });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("trashed notes disappear from every normal read and cannot be edited, reordered or replay-created", async ({ page }) => {
  const f = await fixture(page);
  await trash(page, f.note);
  for (const path of [`/api/knowledge/${f.note.id}`, `/api/knowledge/${f.note.id}?history=1`]) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
  expect(await (await page.request.get(`/api/knowledge?project_id=${f.id}&q=${encodeURIComponent(f.note.title)}`)).json()).toEqual([]);
  const suggestions = await (await page.request.get(`/api/search/suggest?q=${encodeURIComponent(f.note.title)}`)).json();
  expect(suggestions.groups.knowledge).toEqual([]);
  await page.goto(`/search?q=${encodeURIComponent(f.note.title)}`);
  await expect(page.locator('[data-search-section="knowledge"] [data-search-result-id]')).toHaveCount(0);
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await expect(page.locator("[data-knowledge]")).not.toContainText(f.note.title);
  expect((await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: f.note.revision, title: "stale" } })).status()).toBe(404);
  expect((await page.request.post("/api/knowledge/reorder", { data: { project_id: f.id, note_id: f.note.id, target_id: f.other.id, placement: "before" } })).status()).toBe(404);
  const data = { project_id: f.id, title: "再送", body: "原本", create_key: crypto.randomUUID() };
  const created = await (await page.request.post("/api/knowledge", { data })).json();
  await trash(page, created);
  expect((await page.request.post("/api/knowledge", { data })).status()).toBe(409);
});

test("stale delete/restore/edit requests fail without overwriting newer content", async ({ page }) => {
  const f = await fixture(page);
  expect((await page.request.delete(`/api/knowledge/${f.note.id}`)).status()).toBe(400);
  expect((await page.request.delete(`/api/knowledge/${f.note.id}?revision=0`)).status()).toBe(409);
  await trash(page, f.note);
  expect((await page.request.post(`/api/knowledge/${f.note.id}/restore`, { data: { expected_revision: f.note.revision } })).status()).toBe(409);
  const restores = await Promise.all([1, 2].map(() => page.request.post(`/api/knowledge/${f.note.id}/restore`, { data: { expected_revision: f.note.revision + 1 } })));
  expect(restores.map(r => r.status()).sort()).toEqual([200, 409]);
  expect((await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: f.note.revision, title: "stale" } })).status()).toBe(409);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toMatchObject({ body_doc: f.note.body_doc, title: f.note.title });
});

test("viewer/outsider access, trash privileges and revoked membership are enforced on every read", async ({ page, browser }) => {
  const f = await fixture(page);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await other.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } })).status()).toBe(200);
    expect((await other.request.get(`/api/knowledge/${f.note.id}`)).status()).toBe(403);
    expect((await other.request.get(`/api/knowledge?project_id=${f.id}`)).status()).toBe(403);
    expect(await (await other.request.get(`/api/search/suggest?q=${encodeURIComponent(f.note.title)}`)).json().then(d => d.groups.knowledge)).toEqual([]);
    expect((await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } })).status()).toBe(201);
    expect((await other.request.get(`/api/knowledge/${f.note.id}`)).status()).toBe(200);
    expect((await other.request.get(`/api/knowledge/${f.note.id}?history=1`)).status()).toBe(200);
    await trash(page, f.note);
    expect((await other.request.get(`/api/knowledge/trash?project_id=${f.id}`)).status()).toBe(403);
    expect((await other.request.post(`/api/knowledge/${f.note.id}/restore`, { data: { expected_revision: f.note.revision + 1 } })).status()).toBe(403);
    const viewer = await other.newPage(); await viewer.goto(`/projects/${f.id}?view=knowledge`);
    await expect(viewer.getByRole("button", { name: "ゴミ箱", exact: true })).toHaveCount(0);
    expect((await page.request.patch(`/api/projects/${f.id}/members/2`, { data: { role: "editor" } })).status()).toBe(200);
    expect((await other.request.get(`/api/knowledge/trash?project_id=${f.id}`)).status()).toBe(200);
    expect((await other.request.post(`/api/knowledge/${f.note.id}/restore`, { data: { expected_revision: f.note.revision + 1 } })).status()).toBe(200);
    expect((await page.request.delete(`/api/projects/${f.id}/members/2`)).status()).toBe(200);
    expect((await other.request.get(`/api/knowledge/${f.note.id}`)).status()).toBe(403);
    expect((await other.request.get(`/api/knowledge/${f.note.id}?history=1`)).status()).toBe(403);
    expect((await other.request.get(`/api/knowledge/trash?project_id=${f.id}`)).status()).toBe(403);
    expect(await (await other.request.get(`/api/search/suggest?q=${encodeURIComponent(f.note.title)}`)).json().then(d => d.groups.knowledge)).toEqual([]);
  } finally { await other.close(); }
});

test("failed restore stays in trash and can be retried", async ({ page }) => {
  const f = await fixture(page); await trash(page, f.note);
  await page.goto(`/projects/${f.id}?view=knowledge`);
  await page.getByRole("button", { name: "ゴミ箱", exact: true }).click();
  await page.route(`**/api/knowledge/${f.note.id}/restore`, route => route.fulfill({ status: 503, json: { error: "一時的な接続エラー" } }));
  const restore = page.getByRole("button", { name: `「${f.note.title}」を復元`, exact: true });
  await restore.click();
  await expect(page.locator("[data-knowledge-trash]").getByRole("alert")).toContainText("一時的な接続エラー");
  await expect(restore).toBeEnabled();
  await page.unroute(`**/api/knowledge/${f.note.id}/restore`);
  await restore.click(); await expect(page.getByRole("heading", { name: f.note.title, exact: true })).toBeVisible();
});
