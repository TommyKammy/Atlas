import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";

test.describe.configure({ mode: "serial" });
const login = { email: "admin@example.com", password: "atlas-dev-2026" };
const projects = new WeakMap<Page, number[]>();
async function generateFromOverview(page: Page, name: string) {
  await page.getByRole("button", { name: "プロジェクトパートナー", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
function sql(query: string) {
  const stack = process.env.ATLAS_E2E_STACK;
  if (!/^atlas-e2e-[a-f0-9]{32}$/.test(stack ?? "") || !/^[a-f0-9]{32}$/.test(process.env.ATLAS_E2E_MARKER ?? "")) throw Error("Disposable stack required");
  const args = ["exec", "-i", `${stack}-db-1`, "psql", "-X", "-U", "atlas", "-d", "atlas_e2e", "-At", "-v", "ON_ERROR_STOP=1"];
  expect(execFileSync("docker", args, { input: "SELECT marker FROM atlas_e2e_identity", encoding: "utf8" }).trim()).toBe(process.env.ATLAS_E2E_MARKER);
  return execFileSync("docker", args, { input: query, encoding: "utf8" }).trim();
}
async function fixture(page: Page, model = "partner-two") {
  const p = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `承認・報告 ${Date.now()}` } });
  expect(p.status()).toBe(201); const { id } = await p.json(); projects.set(page, [...projects.get(page) ?? [], id]);
  const note = await (await page.request.post("/api/knowledge", { data: { project_id: id, title: "確認用の議事録", body: model === "partner-prefill" ? "佐藤さんが月曜日までに公開告知の文章をまとめる。" : "田中が金曜日までに計画を確認する。\n佐藤が月曜日までに資料をまとめる。" } })).json();
  expect((await page.request.post(`/api/projects/${id}/members`, { data: { user_id: 2, role: "editor" } })).status()).toBe(201);
  const c = await page.request.post("/api/admin/llm", { data: { name: `Workflows ${id}`, provider: "compatible", base_url: "http://llm-mock:8080/v1", model, enabled: true, external_allowed: false, project_ids: [id], max_input_chars: 20000, max_output_tokens: 2048, timeout_seconds: 10, daily_limit: 1000 } });
  expect(c.status()).toBe(200);
  return { id, note, connection: await c.json() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function generate(request: APIRequestContext, f: Fixture, skill = "action_extract", requestId = crypto.randomUUID()) {
  return request.post(`/api/projects/${f.id}/partner`, { data: { skill, request_id: requestId, ...(skill === "action_extract" ? { note_id: f.note.id, expected_revision: f.note.revision } : {}) } });
}
async function candidate(request: APIRequestContext, f: Fixture) {
  const r = await generate(request, f); expect(r.status(), await r.text()).toBe(200); return r.json();
}
const approval = (batch: string, count = 1) => ({ batch_id: batch, confirmed: true, actions: Array.from({ length: count }, (_, index) => ({ index, title: `承認した仕事 ${index + 1}`, assignee_id: 2, due_on: "2026-12-01", section_id: null })) });
const endpoint = (f: Fixture) => `/api/projects/${f.id}/partner/actions`;
const taskCount = (f: Fixture) => Number(sql(`SELECT count(*) FROM tasks WHERE project_id=${f.id}`));
test.beforeEach(async ({ page }) => { expect((await page.request.post("/api/auth/login", { data: login })).status()).toBe(200); });
test.afterEach(async ({ page }) => { await page.goto("about:blank"); for (const id of projects.get(page) ?? []) expect((await page.request.delete(`/api/projects/${id}`)).status()).toBe(200); });

for (const width of [1440, 390]) test(`prefilled member weekday and model section remain editable at ${width}px`, async ({ page }) => {
  const f = await fixture(page, "partner-prefill");
  expect((await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 3, role: "editor" } })).status()).toBe(201);
  const sectionResponse = await page.request.post("/api/sections", { data: { project_id: f.id, name: "広報" } });
  expect(sectionResponse.status()).toBe(201); const section = await sectionResponse.json();
  await page.setViewportSize({ width, height: 1100 }); await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
  const responsePromise = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/projects/${f.id}/partner`));
  await page.getByRole("menuitem", { name: "アクションを抽出" }).click();
  const output = await (await responsePromise).json(); expect(output.actions[0].section_id).toBe(section.id);
  const options = await (await page.request.get(`${endpoint(f)}?batch_id=${output.action_batch_id}`)).json();
  expect(options.suggestions[0]).toMatchObject({ assignee_id: 3, section_id: section.id }); expect(options.suggestions[0].due_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const form = page.locator("[data-partner-approval]"); await form.getByLabel("候補1を選択", { exact: true }).check();
  await expect(form.getByLabel("候補1の担当者", { exact: true })).toHaveValue("3");
  await expect(form.getByLabel("候補1の期限", { exact: true })).toHaveValue(options.suggestions[0].due_on);
  await expect(form.getByLabel("候補1のセクション", { exact: true })).toHaveValue(String(section.id));
  await expect(form).toContainText("日本時間"); await expect(form).toContainText("公開告知の文章を準備する仕事のため");
  expect(taskCount(f)).toBe(0); await page.screenshot({ path: test.info().outputPath(`prefilled-action-${width}.png`), fullPage: true });
  // Clearing or overriding a suggestion must never silently restore the model's value.
  await form.getByLabel("候補1の担当者", { exact: true }).selectOption("");
  await form.getByLabel("候補1を選択", { exact: true }).uncheck(); await form.getByLabel("候補1を選択", { exact: true }).check();
  await expect(form.getByLabel("候補1の担当者", { exact: true })).toHaveValue("");
  await form.getByLabel("候補1の担当者", { exact: true }).selectOption("2");
  await form.getByLabel("候補1の期限", { exact: true }).fill("2026-12-03");
  await form.getByLabel("候補1のセクション", { exact: true }).selectOption("");
  await form.getByRole("button", { name: "選択した1件を確認" }).click(); await form.getByRole("button", { name: "内容を修正" }).click();
  await expect(form.getByLabel("候補1の担当者", { exact: true })).toHaveValue("2");
  await expect(form.getByLabel("候補1の期限", { exact: true })).toHaveValue("2026-12-03");
  await expect(form.getByLabel("候補1のセクション", { exact: true })).toHaveValue("");
  await form.getByRole("button", { name: "選択した1件を確認" }).click(); await form.getByRole("button", { name: "承認して1件を追加" }).click();
  await expect(form.getByRole("status")).toContainText("1件のタスクを追加しました");
  const task = JSON.parse(sql(`SELECT row_to_json(t) FROM (SELECT assignee_id,due_on,section_id FROM tasks WHERE project_id=${f.id}) t`));
  expect(task).toEqual({ assignee_id: 2, due_on: "2026-12-03", section_id: null });
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toEqual(f.note);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`approval preview and bulk creation persist assigned dated tasks at ${width}px`, async ({ page }) => {
  const f = await fixture(page); await page.setViewportSize({ width, height: 1000 });
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click(); await page.getByRole("menuitem", { name: "アクションを抽出" }).click();
  const form = page.locator("[data-partner-approval]");
  await expect(form.locator("[data-partner-action]")).toHaveCount(2);
  expect(taskCount(f)).toBe(0);
  for (const n of [1, 2]) {
    await form.getByLabel(`候補${n}を選択`, { exact: true }).check();
    await form.getByLabel(`候補${n}のタスク名`, { exact: true }).fill(`確認して追加 ${n}`);
    await form.getByLabel(`候補${n}の担当者`, { exact: true }).selectOption("2");
    await form.getByLabel(`候補${n}の期限`, { exact: true }).fill("2026-12-01");
  }
  await form.getByRole("button", { name: "選択した2件を確認" }).click();
  await expect(form.locator("[data-partner-approval-review]")).toContainText("追加先"); expect(taskCount(f)).toBe(0);
  await page.screenshot({ path: test.info().outputPath(`approval-review-${width}.png`), fullPage: true });
  await form.getByRole("button", { name: "承認して2件を追加" }).click();
  await expect(form.getByRole("status")).toContainText("2件のタスクを追加しました");
  await expect(form.getByRole("link", { name: "追加済み · タスクを開く", exact: true })).toHaveCount(2);
  expect(taskCount(f)).toBe(2);
  const tasks = JSON.parse(sql(`SELECT json_agg(json_build_object('name',name,'assignee_id',assignee_id,'due_on',due_on,'created_by',created_by,'description',description) ORDER BY id) FROM tasks WHERE project_id=${f.id}`));
  expect(tasks.map((t: { name: string }) => t.name)).toEqual(["確認して追加 1", "確認して追加 2"]);
  for (const t of tasks) { expect(t).toMatchObject({ assignee_id: 2, due_on: "2026-12-01", created_by: 1 }); expect(t.description).toContain(`note=${f.note.id}`); }
  expect(Number(sql(`SELECT count(*) FROM domain_events WHERE project_id=${f.id} AND type='task.created'`))).toBe(2);
  expect(Number(sql(`SELECT count(*) FROM audit_log WHERE project_id=${f.id} AND action='partner.action.approve'`))).toBe(2);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toEqual(f.note);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}?history=1`)).json()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await form.getByRole("link", { name: "追加済み · タスクを開く", exact: true }).first().click();
  await expect(page).toHaveURL(/view=list/); await page.reload(); await expect(page.getByText("確認して追加 1", { exact: true }).first()).toBeVisible();
  await expect(page.locator("[data-task-description]").getByRole("link", { name: "元ノートを開く", exact: true })).toHaveAttribute("href", `/projects/${f.id}?view=knowledge&note=${f.note.id}`);
});

test("concurrent retries, regenerated candidates and deleted tasks never duplicate approved tasks", async ({ page }) => {
  const f = await fixture(page), output = await candidate(page.request, f), body = approval(output.action_batch_id);
  const responses = await Promise.all([1, 2].map(() => page.request.post(endpoint(f), { data: body })));
  expect(responses.map(r => r.status())).toEqual([200, 200]); expect(taskCount(f)).toBe(1);
  const values = await Promise.all(responses.map(r => r.json())); expect(values.map(v => v.created_count).sort()).toEqual([0, 1]);
  expect(values[0].approved[0].task_id).toBe(values[1].approved[0].task_id);
  const again = await candidate(page.request, f);
  const options = await (await page.request.get(`${endpoint(f)}?batch_id=${again.action_batch_id}`)).json(); expect(options.approved).toHaveLength(1);
  expect((await page.request.post(endpoint(f), { data: { ...body, batch_id: again.action_batch_id } })).status()).toBe(200); expect(taskCount(f)).toBe(1);
  const id = values[0].approved[0].task_id; sql(`DELETE FROM tasks WHERE id=${id};`);
  const replay = await (await page.request.post(endpoint(f), { data: body })).json(); expect(replay.created_count).toBe(0); expect(replay.approved[0].task_id).toBeNull(); expect(taskCount(f)).toBe(0);
  expect(Number(sql(`SELECT count(*) FROM domain_events WHERE project_id=${f.id} AND type='task.created'`))).toBe(1);
});

test("invalid members, dates, sections, forgery and stale sources roll back the whole selection", async ({ page }) => {
  const f = await fixture(page), other = await fixture(page), output = await candidate(page.request, f), body = approval(output.action_batch_id, 2);
  const otherSection = Number(sql(`SELECT id FROM sections WHERE project_id=${other.id} LIMIT 1`));
  for (const change of [{ assignee_id: 3 }, { due_on: "2026-02-30" }, { section_id: otherSection }, { index: 14 }]) {
    const r = await page.request.post(endpoint(f), { data: { ...body, actions: [body.actions[0], { ...body.actions[1], ...change }] } });
    expect(r.status(), await r.text()).toBe(400); expect(taskCount(f)).toBe(0);
  }
  expect((await page.request.post(endpoint(f), { data: { ...body, confirmed: false } })).status()).toBe(400);
  expect((await page.request.post(endpoint(f), { data: { ...body, user_id: 2 } })).status()).toBe(400);
  expect((await page.request.post(endpoint(other), { data: body })).status()).toBe(404);
  expect((await page.request.patch(`/api/knowledge/${f.note.id}`, { data: { expected_revision: f.note.revision, body: "更新後の議事録" } })).status()).toBe(200);
  expect((await page.request.post(endpoint(f), { data: body })).status()).toBe(409); expect(taskCount(f)).toBe(0);
});

test("only the generating editor can approve; revocation and inactive assignees block writes", async ({ page, browser }) => {
  const f = await fixture(page), adminOutput = await candidate(page.request, f);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await context.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: login.password } });
    expect((await context.request.post(endpoint(f), { data: approval(adminOutput.action_batch_id) })).status()).toBe(404);
    const own = await candidate(context.request, f);
    await page.request.patch(`/api/projects/${f.id}/members/2`, { data: { role: "viewer" } });
    expect((await context.request.post(endpoint(f), { data: approval(own.action_batch_id) })).status()).toBe(403);
    await page.request.delete(`/api/projects/${f.id}/members/2`);
    expect((await page.request.post(endpoint(f), { data: approval(adminOutput.action_batch_id) })).status()).toBe(400);
    await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "editor" } });
    sql("UPDATE users SET deactivated_at=now() WHERE id=2;");
    try { expect((await page.request.post(endpoint(f), { data: approval(adminOutput.action_batch_id) })).status()).toBe(400); }
    finally { sql("UPDATE users SET deactivated_at=NULL WHERE id=2;"); }
    expect(taskCount(f)).toBe(0);
  } finally { await context.close(); }
});

for (const width of [1440, 390]) test(`reports survive navigation, reload and review in a chronological feed at ${width}px`, async ({ page }) => {
  const f = await fixture(page); await page.setViewportSize({ width, height: 1000 });
  await page.goto(`/projects/${f.id}?view=overview`); const feed = page.locator("[data-partner-report-feed]");
  await expect(feed).toBeHidden();
  await page.getByRole("tab", { name: /^報告履歴/ }).click();
  await expect(feed).toContainText("ここに履歴が残ります");
  for (const name of ["状況を確認", "週次報告を作成"]) {
    await generateFromOverview(page, name); await expect(page.locator("[data-partner-result]")).toBeVisible();
  }
  await expect(feed.locator("[data-partner-report]")).toHaveCount(2);
  await expect(feed.locator("[data-partner-report]").first()).toContainText("週次報告");
  await page.goto(`/projects/${f.id}?view=knowledge`); await page.goto(`/projects/${f.id}?view=overview`); await page.reload();
  await expect(feed).toBeHidden(); await page.getByRole("tab", { name: /^報告履歴/ }).click();
  await expect(feed.locator("[data-partner-report]")).toHaveCount(2);
  await feed.getByRole("button", { name: "報告を読む", exact: true }).first().click();
  await expect(page.locator("[data-project-partner-panel]")).toContainText("対象期間");
  await feed.getByRole("button", { name: "確認済みにする", exact: true }).first().click();
  await expect(feed.locator("[data-partner-report]").first()).toContainText("確認済み");
  await page.reload(); await page.getByRole("tab", { name: /^報告履歴/ }).click(); await expect(feed.locator("[data-partner-report]").first()).toContainText("管理者 が");
  await page.screenshot({ path: test.info().outputPath(`report-feed-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(taskCount(f)).toBe(0); expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toEqual(f.note);
});

for (const width of [1440, 390]) test(`overview B keeps the project brief clear and preserves report history at ${width}px`, async ({ page }) => {
  const f = await fixture(page), hidden = await fixture(page);
  sql(`UPDATE projects SET owner_id=2,due_on='2026-12-18',description='導入から初回利用までを、迷わず進められる体験にする。' WHERE id=${f.id};
    INSERT INTO tasks(project_id,name,is_milestone,due_on) VALUES(${f.id},'仕様確定',true,'2026-11-20');
    INSERT INTO tasks(project_id,name,is_milestone,deleted_at) VALUES(${f.id},'DELETED_MILESTONE',true,now());
    INSERT INTO tasks(project_id,name,is_milestone) VALUES(${hidden.id},'PRIVATE_MILESTONE',true);`);
  for (let i = 0; i < 7; i++) expect((await generate(page.request, f, i % 2 ? "project_status" : "weekly_report")).status()).toBe(200);
  const saved = await (await page.request.get(`/api/projects/${f.id}/partner/reports`)).json(); expect(saved.total).toBe(7);
  const checksum = () => sql(`SELECT md5(string_agg(payload::text,E'\n' ORDER BY id)) FROM partner_reports WHERE project_id=${f.id};`);
  const before = checksum(), errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width, height: 1100 }); await page.goto(`/projects/${f.id}?view=overview`);
  const overview = page.getByRole("tab", { name: "全体像", exact: true }), history = page.getByRole("tab", { name: /^報告履歴/ }), feed = page.locator("[data-partner-report-feed]");
  await expect(overview).toHaveAttribute("aria-selected", "true"); await expect(history).toContainText("7"); await expect(feed).toBeHidden();
  await expect(page.getByRole("heading", { name: "プロジェクトの目的" })).toBeVisible();
  await expect(page.locator("[data-overview-facts]")).toContainText("田中 太郎"); await expect(page.locator("[data-overview-facts]")).toContainText("2026/12/18");
  await expect(page.getByRole("region", { name: "マイルストーン", exact: true })).toContainText("仕様確定");
  await expect(page.locator("[data-overview-workspace]")).not.toContainText("DELETED_MILESTONE"); await expect(page.locator("[data-overview-workspace]")).not.toContainText("PRIVATE_MILESTONE");
  await page.screenshot({ path: test.info().outputPath(`overview-b-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("[data-project-description-edit]").click(); await page.locator("[data-project-description-input]").fill("保存していない説明の下書き");
  await overview.focus(); await page.keyboard.press("ArrowRight"); await expect(history).toBeFocused(); await expect(feed).toBeVisible();
  await expect(page.locator("[data-project-description-input]")).toBeHidden(); await expect(feed.locator("[data-partner-report]")).toHaveCount(5);
  await feed.getByRole("button", { name: "過去の報告を見る" }).click(); await expect(feed.locator("[data-partner-report]")).toHaveCount(7);
  await overview.click(); await expect(page.locator("[data-project-description-input]")).toHaveValue("保存していない説明の下書き");
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.locator("[data-overview-latest-report]").getByRole("button", { name: "報告を読む" }).click();
  await expect(history).toHaveAttribute("aria-selected", "true"); await expect(page.locator("[data-partner-result]")).toBeVisible();
  await expect(feed.locator("[data-partner-report]")).toHaveCount(7);
  await page.getByRole("button", { name: "提案を閉じる", exact: true }).click();
  await expect(page.getByRole("button", { name: "プロジェクトパートナー", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "プロジェクトパートナー", exact: true }).press("ArrowDown"); await expect(page.getByRole("menuitem", { name: "状況を確認", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("menu", { name: "プロジェクトパートナー" })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath(`overview-history-${width}.png`), fullPage: true });
  await page.reload(); await expect(overview).toHaveAttribute("aria-selected", "true"); await history.click(); await expect(feed.locator("[data-partner-report]")).toHaveCount(5);
  expect(checksum()).toBe(before); expect(errors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("report pagination and review preserve immutable content; access follows live membership", async ({ page, browser }) => {
  const f = await fixture(page); const ids: number[] = [];
  for (let i = 0; i < 7; i++) { const r = await generate(page.request, f, i % 2 ? "weekly_report" : "project_status"); expect(r.status(), await r.text()).toBe(200); ids.push((await r.json()).report_id); }
  const path = `/api/projects/${f.id}/partner/reports`;
  const first = await (await page.request.get(path)).json(); expect(first.items.map((r: { id: number }) => r.id)).toEqual(ids.slice(2).reverse());
  const second = await (await page.request.get(`${path}?before=${first.next_cursor}`)).json(); expect(second.items.map((r: { id: number }) => r.id)).toEqual(ids.slice(0, 2).reverse()); expect(second.next_cursor).toBeNull();
  const before = await (await page.request.get(`${path}/${ids[0]}`)).json();
  expect((await page.request.patch(`${path}/${ids[0]}`, { data: { reviewed: true, payload: {} } })).status()).toBe(400);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await context.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: login.password } });
    await page.request.patch(`/api/projects/${f.id}/members/2`, { data: { role: "viewer" } });
    expect((await context.request.get(path)).status()).toBe(200); expect((await context.request.get(`${path}/${ids[0]}`)).status()).toBe(200);
    expect((await context.request.patch(`${path}/${ids[0]}`, { data: { reviewed: true } })).status()).toBe(403);
    const viewer = await context.newPage(); await viewer.goto(`/projects/${f.id}?view=overview`);
    await viewer.getByRole("tab", { name: /^報告履歴/ }).click();
    await expect(viewer.locator("[data-partner-report]")).toHaveCount(5);
    await expect(viewer.getByRole("button", { name: "プロジェクトパートナー", exact: true })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "状況を確認", exact: true })).toHaveCount(0);
    await viewer.getByRole("button", { name: "報告を読む", exact: true }).first().click(); await expect(viewer.locator("[data-partner-result]")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "再生成", exact: true })).toHaveCount(0);
    await page.request.delete(`/api/projects/${f.id}/members/2`);
    expect((await context.request.get(path)).status()).toBe(403); expect((await context.request.get(`${path}/${ids[0]}`)).status()).toBe(404);
  } finally { await context.close(); }
  const reviews = await Promise.all([1, 2].map(() => page.request.patch(`${path}/${ids[0]}`, { data: { reviewed: true } })));
  expect(reviews.map(r => r.status())).toEqual([200, 200]);
  const after = await (await page.request.get(`${path}/${ids[0]}`)).json(); expect(after.result).toEqual(before.result);
  expect(after.report.reviewed_at).toBeTruthy(); expect(Number(sql(`SELECT count(*) FROM audit_log WHERE project_id=${f.id} AND action='partner.report.review'`))).toBe(1);
  expect(Number(sql(`SELECT count(*) FROM domain_events WHERE project_id=${f.id}`))).toBe(0);
});

test("invalid generation is not saved and a repeated request cannot append duplicate reports", async ({ page }) => {
  const f = await fixture(page, "bad-json"); const path = `/api/projects/${f.id}/partner/reports`;
  expect((await generate(page.request, f, "project_status")).status()).toBe(502);
  expect((await (await page.request.get(path)).json()).items).toHaveLength(0);
  await page.request.post("/api/admin/llm", { data: { ...f.connection, model: "fixture" } });
  const id = crypto.randomUUID(); expect((await generate(page.request, f, "project_status", id)).status()).toBe(200);
  expect((await generate(page.request, f, "project_status", id)).status()).toBe(409);
  expect((await (await page.request.get(path)).json()).items).toHaveLength(1);
  const other = await fixture(page); const report = (await (await page.request.get(path)).json()).items[0];
  expect((await page.request.get(`/api/projects/${other.id}/partner/reports/${report.id}`)).status()).toBe(404);
  sql(`UPDATE projects SET deleted_at=now() WHERE id=${f.id};`);
  expect((await page.request.get(path)).status()).toBe(403); expect((await page.request.get(`${path}/${report.id}`)).status()).toBe(404);
  sql(`UPDATE projects SET deleted_at=NULL WHERE id=${f.id};`);
});
