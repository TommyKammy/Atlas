import { expect, test, type Page } from "@playwright/test";
import type { ProjectKnowledge } from "../../lib/data";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const projects = new WeakMap<Page, number>();
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await page.goto("about:blank");
  const id = projects.get(page);
  if (id) await page.request.delete(`/api/projects/${id}`);
});
async function fixture(page: Page, body = "## 元の見出し\n\n既存の日本語ノート\n\n- [x] 完了した項目") {
  const project = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `知識テスト ${Date.now()}` } });
  expect(project.status()).toBe(201);
  const { id } = await project.json(); projects.set(page, id);
  const response = await page.request.post("/api/knowledge", { data: { project_id: id, title: "既存ノート", body } });
  expect(response.status()).toBe(201);
  const note = await response.json() as ProjectKnowledge;
  await page.goto(`/projects/${id}?view=knowledge&note=${note.id}`);
  await expect(page.locator("[data-knowledge]")).toBeVisible();
  return { id, note, body };
}
async function edit(page: Page) {
  await expect(async () => {
    if (await page.locator("[data-knowledge-edit]").isVisible()) await page.locator("[data-knowledge-edit]").click();
    await expect(page.getByRole("textbox", { name: "ノートの本文", exact: true })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10000 });
  await expect(page.locator("[data-knowledge-composer] .atlas-rich-editor")).toHaveAttribute("aria-busy", "false");
  return page.getByRole("textbox", { name: "ノートの本文", exact: true });
}
async function saved(page: Page) {
  await expect(page.locator("[data-knowledge-save-status]")).toHaveText("すべての変更を保存しました", { timeout: 15000 });
}
async function read(page: Page, id: number): Promise<ProjectKnowledge> {
  const response = await page.request.get(`/api/knowledge/${id}`); expect(response.status()).toBe(200); return response.json();
}

test("legacy content stays byte-identical until edited; first version is recoverable", async ({ page }) => {
  const f = await fixture(page, "## 元の文章\n\n  - 階層\n\n| 原文 | 表 |\n| --- | --- |\n| A | B |\n\n日本語  \n次の行");
  await edit(page);
  await page.getByRole("button", { name: "編集を終了", exact: true }).click();
  expect(await read(page, f.note.id)).toMatchObject({ body: f.body, body_doc: null, revision: 0, updated_at: f.note.updated_at });
  const editor = await edit(page);
  await editor.press("ControlOrMeta+End"); await editor.press("Enter"); await editor.pressSequentially("added");
  await saved(page);
  const changed = await read(page, f.note.id);
  expect(changed.body_doc).not.toBeNull(); expect(changed.body).toContain("added");
  const history = await (await page.request.get(`/api/knowledge/${f.note.id}?history=1`)).json();
  expect(history.some((item: { revision: number }) => item.revision === 0)).toBe(true);
  const restored = await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: changed.revision, restore_revision: 0 } });
  expect(restored.status()).toBe(200); expect(await restored.json()).toMatchObject({ body: f.body, body_doc: null });
});

test("slash commands, table, image, block movement, autosave and reload", async ({ page }) => {
  const f = await fixture(page);
  const editor = await edit(page);
  await editor.fill("/table");
  await page.getByRole("button", { name: /3列の表を挿入/ }).click();
  await expect(editor.locator("table")).toBeVisible();
  await editor.locator("th").first().click(); await page.keyboard.insertText("担当者");
  await page.getByRole("button", { name: "表の行を追加", exact: true }).click();
  await expect(editor.locator("tr")).toHaveCount(4);
  await editor.press("ControlOrMeta+End"); await editor.press("ArrowDown"); await editor.press("Enter");
  await page.getByRole("button", { name: "画像を挿入", exact: true }).click();
  await page.getByRole("textbox", { name: "画像URL", exact: true }).fill("javascript:alert(1)");
  await page.locator("form").getByRole("button", { name: "画像を挿入", exact: true }).click();
  await expect(page.getByText("HTTPSの画像URLを入力してください")).toBeVisible();
  await page.route("https://example.com/knowledge-test.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=", "base64") }));
  await page.getByRole("textbox", { name: "画像URL", exact: true }).fill("https://example.com/knowledge-test.png");
  await page.getByRole("textbox", { name: "画像の説明", exact: true }).fill("設計図");
  await page.locator("form").getByRole("button", { name: "画像を挿入", exact: true }).click();
  await expect(editor.locator("img")).toHaveAttribute("referrerpolicy", "no-referrer");
  await saved(page);
  const result = await read(page, f.note.id);
  expect(JSON.stringify(result.body_doc)).toContain("設計図"); expect(result.body).toContain("担当者");
  await page.getByRole("button", { name: "編集を終了", exact: true }).click();
  await page.reload(); await expect(page.locator("[data-knowledge] table")).toBeVisible();
  await expect(page.locator("[data-knowledge] img")).toHaveAttribute("alt", "設計図");
});

test("moving blocks preserves formatting and supports undo", async ({ page }) => {
  const f = await fixture(page, "## First\n\nSecond\n\nThird");
  const editor = await edit(page);
  await editor.locator("p").last().click(); await editor.press("Alt+ArrowUp");
  await expect(editor).toHaveText("FirstThirdSecond");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(editor).toHaveText("FirstSecondThird");
  await page.getByRole("button", { name: "ブロックを上へ (Alt+↑)", exact: true }).click();
  await saved(page); expect((await read(page, f.note.id)).body).toContain("Third\n\nSecond");
});

test("a concurrent save is rejected, preserving both versions", async ({ page }) => {
  const f = await fixture(page);
  const editor = await edit(page);
  expect((await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: 0, title: "別の編集者の更新", body_doc: doc("他の画面の本文") } })).status()).toBe(200);
  await editor.fill("この画面の未保存の文章");
  await expect(page.locator("[data-knowledge]").getByRole("alert")).toContainText("別の画面で更新されています");
  await expect(editor).toContainText("この画面の未保存の文章");
  expect((await read(page, f.note.id)).body).toBe("他の画面の本文");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "変更をファイルに退避" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole("button", { name: "編集を終了", exact: true }).click();
  await expect(editor).toBeVisible();
});

test("a failed save retains the draft and retry persists it", async ({ page }) => {
  const f = await fixture(page);
  const editor = await edit(page);
  await page.route(`**/api/knowledge/${f.note.id}`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "一時的に保存できません" }) }) : route.continue());
  await editor.fill("通信失敗でも失われない本文");
  await expect(page.locator("[data-knowledge]").getByRole("alert")).toContainText("一時的に保存できません");
  await page.unroute(`**/api/knowledge/${f.note.id}`);
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await saved(page); expect((await read(page, f.note.id)).body).toContain("通信失敗でも失われない本文");
});

test("typing during an in-flight save is serialized without losing edits", async ({ page }) => {
  const f = await fixture(page);
  const editor = await edit(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  await page.route(`**/api/knowledge/${f.note.id}`, async route => {
    if (route.request().method() === "PATCH" && first) { first = false; await gate; }
    await route.continue();
  });
  await editor.fill("先に保存");
  await expect(page.locator("[data-knowledge-save-status]")).toHaveText("保存中…");
  await editor.fill("保存中に入力した追加の文章"); release();
  await saved(page); expect((await read(page, f.note.id)).body).toContain("保存中に入力した追加の文章");
});

test("read-only members cannot edit, restore or delete, outsiders cannot read", async ({ page, browser }) => {
  const f = await fixture(page);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await other.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } })).status()).toBe(200);
    expect((await other.request.get(`/api/knowledge/${f.note.id}`)).status()).toBe(403);
    expect((await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } })).status()).toBe(201);
    const viewer = await other.newPage(); await viewer.goto(`/projects/${f.id}?view=knowledge`);
    await expect(viewer.locator("[data-knowledge]")).toBeVisible();
    await expect(viewer.locator("[data-knowledge-new]")).toHaveCount(0); await expect(viewer.locator("[data-knowledge-edit]")).toHaveCount(0);
    expect((await other.request.patch(`/api/knowledge/${f.note.id}`, { data: { title: "拒否", expected_revision: 0 } })).status()).toBe(403);
    expect((await other.request.patch(`/api/knowledge/${f.note.id}`, { data: { restore_revision: 0, expected_revision: 0 } })).status()).toBe(403);
    expect((await other.request.delete(`/api/knowledge/${f.note.id}`)).status()).toBe(403);
    expect((await read(page, f.note.id)).body).toBe(f.body);
  } finally { await other.close(); }
});

test("malformed documents and unsafe URLs are rejected; create retries are idempotent", async ({ page }) => {
  const f = await fixture(page);
  for (const body_doc of [
    { type: "doc", content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] },
    { type: "doc", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] },
  ]) expect((await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: 0, body_doc } })).status()).toBe(400);
  const data = { project_id: f.id, title: "重複しないノート", body_doc: doc("retry"), create_key: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
  const a = await page.request.post("/api/knowledge", { data });
  const b = await page.request.post("/api/knowledge", { data });
  expect(a.status()).toBe(201); expect(b.status()).toBe(201); expect((await a.json()).id).toBe((await b.json()).id);
});

for (const width of [1440, 768, 390]) test(`knowledge layout, template and search at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const f = await fixture(page);
  await page.getByRole("button", { name: "＋ 議事録", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "ノートの本文", exact: true });
  await expect(editor).toContainText("決定事項");
  const item = editor.locator('ul[data-type="taskList"] > li').first();
  await expect.poll(() => item.evaluate(li => {
    const input = li.querySelector("input")!.getBoundingClientRect();
    const text = li.querySelector("p")!.getBoundingClientRect();
    return Math.abs(input.top - text.top) < 16;
  })).toBe(true);
  await page.getByRole("textbox", { name: "ノートのタイトル", exact: true }).fill("リリースに向けた決定事項");
  await saved(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const path = test.info().outputPath(`knowledge-${width}.png`); await page.screenshot({ path, fullPage: true }); await test.info().attach(`knowledge-${width}`, { path, contentType: "image/png" });
  await page.getByRole("button", { name: "編集を終了", exact: true }).click();
  await page.getByRole("searchbox", { name: "ノートを検索" }).fill("既存の日本語");
  await expect(page.locator("[data-knowledge-note]")).toHaveCount(1);
  await page.locator(`[data-knowledge-note="${f.note.id}"]`).click();
  await expect(page.locator("[data-knowledge-legacy]")).toContainText("既存の日本語ノート");
});


test("title-only edits keep the original Markdown and IME confirmation does not submit", async ({ page }) => {
  const f = await fixture(page, "  original  \n\n| table | source |\n\n日本語");
  const editor = await edit(page);
  await page.getByRole("textbox", { name: "ノートのタイトル", exact: true }).fill("タイトルのみ変更");
  await saved(page);
  const result = await read(page, f.note.id);
  expect(result.body).toBe(f.body); expect(result.body_doc).toBeNull();
  let writes = 0;
  page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith(`/api/knowledge/${f.note.id}`)) writes++; });
  await editor.dispatchEvent("compositionstart", { data: "日本語" });
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", ctrlKey: true, isComposing: true, keyCode: 229 });
  await editor.dispatchEvent("compositionend", { data: "日本語" });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(writes).toBe(0);
});

test("failed drafts survive reload within the same tab and remain revision guarded", async ({ page }) => {
  const f = await fixture(page);
  const editor = await edit(page);
  await page.route(`**/api/knowledge/${f.note.id}`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "保存失敗" }) }) : route.continue());
  await editor.fill("再読み込みから復元する下書き");
  await expect(page.locator("[data-knowledge]").getByRole("alert")).toContainText("保存失敗");
  page.once("dialog", dialog => dialog.accept()); await page.reload();
  await page.unroute(`**/api/knowledge/${f.note.id}`);
  const recovered = await edit(page);
  await expect(recovered).toContainText("再読み込みから復元する下書き");
  await expect(page.getByText("このタブに残っていた未保存の下書きを復元しました。")).toBeVisible();
  await saved(page); expect((await read(page, f.note.id)).body).toContain("再読み込みから復元する下書き");
});


test("search and deep links can reach notes older than the first 100 results", async ({ page }) => {
  test.setTimeout(90000);
  const f = await fixture(page, "older-knowledge-unique-content");
  for (let batch = 0; batch < 11; batch++) {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => page.request.post("/api/knowledge", { data: { project_id: f.id, title: `Recent ${batch}-${i}`, body: "recent" } })));
    for (const result of results) expect(result.status()).toBe(201);
  }
  await page.goto(`/projects/${f.id}?view=knowledge`);
  await page.getByRole("searchbox", { name: "ノートを検索" }).fill("older-knowledge-unique-content");
  await expect(page.locator(`[data-knowledge-note="${f.note.id}"]`)).toBeVisible();
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await expect(page.locator("[data-knowledge-legacy]")).toHaveText("older-knowledge-unique-content");
  const malformed = await page.goto(`/projects/${f.id}?view=knowledge&note=Infinity`);
  expect(malformed?.status()).toBe(200);
  await expect(page.locator("[data-knowledge]")).toBeVisible();
});


test("a lost create response plus reload never duplicates a note or loses newer typing", async ({ page }) => {
  const f = await fixture(page);
  await page.locator("[data-knowledge-new]").click();
  const title = page.getByRole("textbox", { name: "ノートのタイトル", exact: true });
  await title.fill("作成応答が失われたノート");
  await page.route("**/api/knowledge", async route => {
    if (route.request().method() === "POST") { await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await expect(page.locator("[data-knowledge]").getByRole("alert")).toBeVisible();
  await page.getByRole("textbox", { name: "ノートの本文", exact: true }).fill("応答喪失後に追記した文章");
  page.once("dialog", dialog => dialog.accept()); await page.reload();
  await page.unroute("**/api/knowledge");
  await page.locator("[data-knowledge-new]").click();
  await expect(page.getByRole("textbox", { name: "ノートの本文", exact: true })).toContainText("応答喪失後に追記した文章");
  await saved(page);
  const notes = await (await page.request.get(`/api/knowledge?project_id=${f.id}`)).json();
  const created = notes.filter((note: ProjectKnowledge) => note.title === "作成応答が失われたノート");
  expect(created).toHaveLength(1); expect(created[0].body).toContain("応答喪失後に追記した文章");
});


test("the exact original remains restorable beyond the recent history window", async ({ page }) => {
  const f = await fixture(page, "原文を50回の更新後も保持する");
  for (let revision = 0; revision < 52; revision++) {
    expect((await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { title: `更新 ${revision}`, expected_revision: revision } })).status()).toBe(200);
  }
  const history = await (await page.request.get(`/api/knowledge/${f.note.id}?history=1`)).json();
  expect(history).toHaveLength(51); expect(history.at(-1).revision).toBe(0);
  const restored = await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: 52, restore_revision: 0 } });
  expect(restored.status()).toBe(200); expect(await restored.json()).toMatchObject({ title: f.note.title, body: f.body, body_doc: null });
});
