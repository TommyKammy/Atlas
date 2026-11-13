import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const login = { email: "admin@example.com", password: "atlas-dev-2026" };
const created = new WeakMap<Page, number>();
test.beforeEach(async ({ page }) => { expect((await page.request.post("/api/auth/login", { data: login })).status()).toBe(200); });
test.afterEach(async ({ page }) => { await page.goto("about:blank"); const id = created.get(page); if (id) expect((await page.request.delete(`/api/projects/${id}`)).status()).toBe(200); });
async function fixture(page: Page, model = "fixture", daily_limit = 1000) {
  const p = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `AI検証 ${Date.now()}` } });
  expect(p.status()).toBe(201); const { id } = await p.json(); created.set(page, id);
  const note = await (await page.request.post("/api/knowledge", { data: { project_id: id, title: "計画を確認するノート", body: "明日はチームで計画を確認します。担当者と期限を決めます。\n[内部参照](https://example.invalid/secret)" } })).json();
  const data = { name: `Fixture ${id}`, provider: "compatible", base_url: "http://llm-mock:8080/v1", model, enabled: true, external_allowed: false, project_ids: [id], max_input_chars: 20000, max_output_tokens: 2048, timeout_seconds: 10, daily_limit };
  const response = await page.request.post("/api/admin/llm", { data }); expect(response.status(), await response.text()).toBe(200);
  const connection = await response.json();
  return { id, note, connection, payload: { connection_id: connection.id, expected_revision: note.revision, operation: "summary", request_id: crypto.randomUUID() } };
}
async function generate(request: APIRequestContext, f: Awaited<ReturnType<typeof fixture>>, extra = {}) {
  return request.post(`/api/knowledge/${f.note.id}/ai`, { data: { ...f.payload, request_id: crypto.randomUUID(), ...extra } });
}
for (const width of [1440, 390]) test(`AI summary, improvements, copy and separate save preserve source at ${width}px`, async ({ page, context }) => {
  const f = await fixture(page); await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "要約を生成", exact: true })).toBeEnabled();
  await page.getByRole("menuitem", { name: "文章改善案を生成", exact: true }).click();
  await expect(page.locator("[data-ai-output]")).toContainText("改善ポイント");
  await page.getByRole("tab", { name: "要約", exact: true }).click();
  await page.getByRole("button", { name: "要約を生成", exact: true }).click();
  await expect(page.locator("[data-ai-output]")).toContainText("要約");
  const summary = await page.locator("[data-ai-output]").innerText();
  await page.getByRole("tab", { name: "文章改善案", exact: true }).click();
  await expect(page.locator("[data-ai-output]")).toContainText("改善ポイント");
  await page.getByRole("tab", { name: "要約", exact: true }).click();
  await expect(page.locator("[data-ai-output]")).toHaveText(summary, { useInnerText: true });
  const panelBox = await page.locator("[data-ai-panel]").boundingBox();
  const documentBox = await page.locator("[data-knowledge-document-column]").boundingBox();
  if (width >= 1280) expect(panelBox!.x).toBeGreaterThanOrEqual(documentBox!.x + documentBox!.width);
  else expect(panelBox!.y).toBeGreaterThanOrEqual(documentBox!.y + documentBox!.height);
  await page.getByRole("button", { name: "AIアシストを閉じる", exact: true }).click();
  await expect(page.locator("[data-ai-panel]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AIアシスト", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
  await page.getByRole("menuitem", { name: "結果パネルを表示" }).click();
  await expect(page.locator("[data-ai-output]")).toHaveText(summary, { useInnerText: true });
  expect(await page.locator("[data-ai-result] img").count()).toBe(0);
  expect(await page.evaluate(() => "aiInjected" in window)).toBe(false);
  await page.getByRole("button", { name: "コピー", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "コピーしました" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("チームで計画");
  await page.screenshot({ path: test.info().outputPath(`ai-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("別ノートのタイトル").fill("AIで作った別ノート");
  await page.getByRole("button", { name: "別ノートとして保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AIで作った別ノート", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "AIで作った別ノート", exact: true })).toBeVisible();
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toEqual(f.note);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}?history=1`)).json()).toEqual([]);
  const notes = await (await page.request.get(`/api/knowledge?project_id=${f.id}`)).json();
  expect(notes).toHaveLength(2); expect(notes[1].body_doc.content[0].content[0].type).toBe("text");
  await expect(page.locator(".knowledge-document img")).toHaveCount(0);
});
test("toolbar menus support keyboard navigation and note switches cancel in-flight output", async ({ page }) => {
  const f = await fixture(page, "slow");
  const other = await (await page.request.post("/api/knowledge", { data: { project_id: f.id, title: "切り替え先", body: "別のノートです。" } })).json();
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  const more = page.getByRole("button", { name: "ノートのその他の操作" });
  await more.focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "履歴", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "ゴミ箱に移す", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(more).toBeFocused();
  await more.click(); await page.getByRole("menuitem", { name: "履歴", exact: true }).click();
  await expect(page.locator("[data-knowledge-history]")).toBeVisible();
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
  await page.getByRole("menuitem", { name: "要約を生成", exact: true }).click();
  await expect(page.getByRole("button", { name: "中止", exact: true })).toBeVisible();
  await page.locator(`[data-knowledge-note="${other.id}"]`).click();
  await expect(page.getByRole("heading", { name: "切り替え先", exact: true })).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(page.locator("[data-ai-panel]")).toHaveCount(0);
  await expect(page.locator("[data-ai-output]")).toHaveCount(0);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toEqual(f.note);
});
for (const width of [1440, 390]) test(`switching rich and legacy notes keeps exactly one AI panel at ${width}px`, async ({ page }) => {
  const f = await fixture(page);
  const notes = [f.note];
  for (const title of ["リッチノートA", "リッチノートB"]) {
    const response = await page.request.post("/api/knowledge", { data: {
      project_id: f.id, title, body_doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `${title}の本文` }] }] },
    } });
    expect(response.status()).toBe(201); notes.push(await response.json());
  }
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`/projects/${f.id}?view=knowledge&note=${notes[1].id}`);
  const panels = page.getByRole("region", { name: "ノートのAIアシスト", exact: true });
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
  await page.getByRole("menuitem", { name: "要約を生成", exact: true }).click();
  await expect(page.locator("[data-ai-output]")).toBeVisible();
  for (const index of [2, 1, 2, 0, 1, 0, 2, 1, 2, 0, 1, 2]) {
    const note = notes[index];
    await page.locator(`[data-knowledge-note="${note.id}"]`).click();
    await expect(page.getByRole("heading", { name: note.title, exact: true })).toBeVisible();
    await expect(panels).toHaveCount(0);
    await expect(page.locator("[data-ai-result]")).toHaveCount(0);
    await expect(page.locator(".knowledge-document")).toHaveCount(1);
    if (note.body_doc) await expect(page.locator(".knowledge-document")).toContainText(`${note.title}の本文`);
    await expect(page.getByRole("button", { name: "AIアシスト", exact: true })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "要約を生成", exact: true })).toBeEnabled();
  }
  await page.screenshot({ path: test.info().outputPath(`ai-note-switch-${width}.png`), fullPage: true });
  expect(errors).toEqual([]);
  for (const note of notes) expect(await (await page.request.get(`/api/knowledge/${note.id}`)).json()).toEqual(note);
});
test("admin settings encrypt/mask keys, connection test and URL changes clear credentials", async ({ page }) => {
  const f = await fixture(page);
  let c = await (await page.request.post("/api/admin/llm", { data: { ...f.connection, api_key: "fixture-secret-not-returned" } })).json();
  expect(c.key_configured).toBe(true); expect(JSON.stringify(c)).not.toContain("fixture-secret"); expect(c.key_cipher).toBeUndefined();
  const listing = await (await page.request.get("/api/admin/llm")).text(); expect(listing).not.toContain("fixture-secret"); expect(listing).not.toContain("key_cipher");
  const check = await page.request.post(`/api/admin/llm/${c.id}/test`, { data: {} }); expect(check.status()).toBe(200); expect((await check.json()).models).toContain("fixture");
  await page.goto("/admin#ai"); await expect(page.locator("[data-llm-settings]")).toBeVisible();
  await page.getByRole("button", { name: `${c.name} · 有効`, exact: true }).click();
  await expect(page.locator('[data-llm-settings] input[type="password"]')).toHaveValue("");
  await page.screenshot({ path: test.info().outputPath("ai-settings.png"), fullPage: true });
  c = await (await page.request.post("/api/admin/llm", { data: { ...c, base_url: "http://llm-mock:8080/changed" } })).json(); expect(c.key_configured).toBe(false);
  expect((await page.request.post("/api/admin/llm", { data: { ...c, base_url: "http://169.254.169.254/v1" } })).status()).toBe(400);
});
test("generation saves once, signed output cannot be altered, stale and deleted sources are rejected", async ({ page }) => {
  const f = await fixture(page);
  const response = await generate(page.request, f); expect(response.status()).toBe(200); const result = await response.json();
  expect(result.source_text).not.toContain("example.invalid/secret");
  const save = { token: result.token, title: "保存した提案" };
  const saves = await Promise.all([1, 2].map(() => page.request.put(`/api/knowledge/${f.note.id}/ai`, { data: save })));
  expect(saves.map(r => r.status())).toEqual([200, 200]); expect((await saves[0].json()).id).toBe((await saves[1].json()).id);
  expect((await page.request.put(`/api/knowledge/${f.note.id}/ai`, { data: { ...save, token: result.token+"x" } })).status()).toBe(400);
  expect((await generate(page.request, f, { expected_revision: 987 })).status()).toBe(409);
  expect((await page.request.delete(`/api/knowledge/${f.note.id}?revision=${f.note.revision}`)).status()).toBe(200);
  expect((await generate(page.request, f)).status()).toBe(403);
  expect((await page.request.put(`/api/knowledge/${f.note.id}/ai`, { data: save })).status()).toBe(403);
});
test("viewers and outsiders cannot generate; membership revocation blocks result delivery and save", async ({ page, browser }) => {
  const f = await fixture(page, "slow");
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await other.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: login.password } })).status()).toBe(200);
    expect((await other.request.get("/api/admin/llm")).status()).toBe(403);
    expect((await generate(other.request, f)).status()).toBe(403);
    await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } });
    expect((await generate(other.request, f)).status()).toBe(403);
    await page.request.patch(`/api/projects/${f.id}/members/2`, { data: { role: "editor" } });
    const ready = await generate(other.request, f); expect(ready.status()).toBe(200); const result = await ready.json();
    const pending = generate(other.request, f); await new Promise(resolve => setTimeout(resolve, 400));
    await page.request.delete(`/api/projects/${f.id}/members/2`);
    expect((await pending).status()).toBe(403);
    expect((await other.request.put(`/api/knowledge/${f.note.id}/ai`, { data: { token: result.token, title: "拒否" } })).status()).toBe(403);
  } finally { await other.close(); }
});
test("concurrent requests are bounded and incomplete provider output is never saved", async ({ page }) => {
  const f = await fixture(page, "slow");
  const pending = generate(page.request, f); await new Promise(resolve => setTimeout(resolve, 400));
  expect((await generate(page.request, f)).status()).toBe(429); expect((await pending).status()).toBe(200);
  const c = await (await page.request.post("/api/admin/llm", { data: { ...f.connection, model: "truncated" } })).json();
  expect(c.model).toBe("truncated");
  const response = await generate(page.request, f); expect(response.status()).toBe(502); expect(await response.text()).not.toContain("token");
  expect(await (await page.request.get(`/api/knowledge?project_id=${f.id}`)).json()).toHaveLength(1);
});
test("cancel leaves the original note unchanged", async ({ page }) => {
  const f = await fixture(page, "slow");
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "要約を生成" })).toBeEnabled();
  await page.getByRole("menuitem", { name: "要約を生成" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "中止", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "生成を中止しました" })).toBeVisible();
  await expect(page.locator("[data-ai-result]")).toHaveCount(0);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toEqual(f.note);
});
test("source edits mark results stale; deletion and configuration changes during generation block delivery", async ({ page }) => {
  const f = await fixture(page, "slow");
  let pending = generate(page.request, f); await new Promise(resolve => setTimeout(resolve, 400));
  const note = await (await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: f.note.revision, body: "更新された原文" } })).json();
  const response = await pending; expect(response.status()).toBe(200); expect((await response.json()).stale).toBe(true);
  pending = generate(page.request, f, { expected_revision: note.revision }); await new Promise(resolve => setTimeout(resolve, 400));
  await page.request.post("/api/admin/llm", { data: { ...f.connection, enabled: false } });
  expect((await pending).status()).toBe(403);
  const c = (await (await page.request.get("/api/admin/llm")).json()).connections.find((c: { id: string }) => c.id === f.connection.id);
  await page.request.post("/api/admin/llm", { data: { ...c, enabled: true } });
  pending = generate(page.request, f, { expected_revision: note.revision }); await new Promise(resolve => setTimeout(resolve, 400));
  await page.request.delete(`/api/knowledge/${f.note.id}?revision=${note.revision}`);
  expect((await pending).status()).toBe(403);
});
test("provider errors and timeouts expose no provider body and leave notes unchanged", async ({ page }) => {
  const f = await fixture(page, "error");
  const error = await generate(page.request, f); expect(error.status()).toBe(502); expect(await error.text()).not.toContain("never log");
  await page.request.post("/api/admin/llm", { data: { ...f.connection, model: "timeout", timeout_seconds: 5 } });
  const timeout = await generate(page.request, f); expect(timeout.status()).toBe(408);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toEqual(f.note);
});
test("disabled profiles and input/quota limits prevent note transmission", async ({ page }) => {
  const f = await fixture(page);
  expect((await generate(page.request, f)).status()).toBe(200);
  let c = await (await page.request.post("/api/admin/llm", { data: { ...f.connection, enabled: false } })).json();
  expect((await generate(page.request, f)).status()).toBe(403);
  c = await (await page.request.post("/api/admin/llm", { data: { ...c, enabled: true, max_input_chars: 100 } })).json();
  const n = await (await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: 0, body: "長".repeat(101) } })).json();
  expect((await generate(page.request, f, { expected_revision: n.revision })).status()).toBe(400);
  await page.request.post("/api/admin/llm", { data: { ...c, max_input_chars: 20000, daily_limit: 1 } });
  expect((await generate(page.request, f, { expected_revision: n.revision })).status()).toBe(429);
});
test("permanent project deletion preserves quota metadata without blocking profile updates", async ({ page }) => {
  const f = await fixture(page);
  expect((await generate(page.request, f)).status()).toBe(200);
  expect((await page.request.delete(`/api/projects/${f.id}`)).status()).toBe(200); created.delete(page);
  const c = (await (await page.request.get("/api/admin/llm")).json()).connections.find((c: { id: string }) => c.id === f.connection.id);
  expect(c.project_ids).toEqual([]);
  expect((await page.request.post("/api/admin/llm", { data: { ...c, enabled: false } })).status()).toBe(200);
});
test("only administrators choose the project model; UI and forged requests cannot override it", async ({ page, browser }) => {
  const f = await fixture(page);
  const changed = await page.request.post("/api/admin/llm", { data: { ...f.connection, id: undefined, revision: undefined, name: `Fixture ${f.id} assigned`, model: "admin-selected" } });
  expect(changed.status()).toBe(200); const assigned = await changed.json();
  const configs = (await (await page.request.get("/api/admin/llm")).json()).connections;
  expect(configs.find((c: { id: string }) => c.id === f.connection.id).project_ids).toEqual([]);
  expect(configs.find((c: { id: string }) => c.id === f.connection.id).revision).toBeGreaterThan(f.connection.revision);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await other.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: login.password } })).status()).toBe(200);
    expect((await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "editor" } })).status()).toBe(201);
    expect((await other.request.post("/api/admin/llm", { data: { ...assigned, model: "user-choice" } })).status()).toBe(403);
    const available = await (await other.request.get(`/api/knowledge/${f.note.id}/ai`)).json();
    expect(available).toHaveLength(1); expect(available[0]).toMatchObject({ id: assigned.id, model: "admin-selected" });
    const editor = await other.newPage();
    await editor.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
    await editor.getByRole("button", { name: "AIアシスト", exact: true }).click();
    await expect(editor.getByRole("menuitem", { name: "要約を生成", exact: true })).toBeEnabled();
    await expect(editor.getByRole("menu", { name: "AIアシスト" })).not.toContainText("admin-selected");
    await expect(editor.getByRole("region", { name: "ノートのAIアシスト" }).getByRole("combobox")).toHaveCount(0);
    expect((await generate(other.request, f)).status()).toBe(403); // Previously permitted connection.
    for (const override of [{ model: "user-choice" }, { base_url: "http://example.invalid/v1" }]) {
      expect((await generate(other.request, f, { connection_id: assigned.id, ...override })).status()).toBe(403);
    }
    const generated = await generate(other.request, f, { connection_id: undefined });
    expect(generated.status()).toBe(200); expect((await generated.json()).model).toBe("admin-selected");
    await page.request.post("/api/admin/llm", { data: { ...assigned, model: "updated-by-admin" } });
    await editor.getByRole("menuitem", { name: "要約を生成", exact: true }).click();
    await expect(editor.getByRole("region", { name: "ノートのAIアシスト" }).getByRole("alert")).toContainText("管理者がAI接続設定を更新しました");
    await expect(editor.locator("[data-ai-result]")).toHaveCount(0);
    await editor.reload(); await editor.getByRole("button", { name: "AIアシスト", exact: true }).click();
    await expect(editor.getByRole("menuitem", { name: "要約を生成", exact: true })).toBeEnabled();
    await editor.getByRole("menuitem", { name: "要約を生成", exact: true }).click();
    await expect(editor.locator("[data-ai-output]")).toBeVisible();
    await expect(editor.getByRole("region", { name: "ノートのAIアシスト" })).not.toContainText("updated-by-admin");
    await editor.screenshot({ path: test.info().outputPath("admin-assigned-model.png"), fullPage: true });
  } finally { await other.close(); }
});
test("concurrent administrator assignments select one connection and disabling never falls back", async ({ page }) => {
  const f = await fixture(page, "slow");
  const pending = generate(page.request, f); await page.waitForTimeout(400);
  const replacements = await Promise.all(["B", "C"].map(name => page.request.post("/api/admin/llm", { data: {
    ...f.connection, id: undefined, revision: undefined, name: `Fixture ${f.id} ${name}`, model: `assigned-${name}`,
  } })));
  expect(replacements.map(r => r.status())).toEqual([200, 200]);
  expect((await pending).status()).toBe(403);
  const configs = (await (await page.request.get("/api/admin/llm")).json()).connections;
  const assigned = configs.filter((c: { enabled: boolean; project_ids: number[] }) => c.enabled && c.project_ids.includes(f.id));
  expect(assigned).toHaveLength(1);
  const response = await generate(page.request, f, { connection_id: undefined });
  expect(response.status()).toBe(200); expect((await response.json()).model).toBe(assigned[0].model);
  expect((await page.request.post("/api/admin/llm", { data: { ...assigned[0], enabled: false } })).status()).toBe(200);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}/ai`)).json()).toEqual([]);
  expect((await generate(page.request, f, { connection_id: undefined })).status()).toBe(403);
});
