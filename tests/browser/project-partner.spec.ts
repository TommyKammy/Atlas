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
  if (!/^atlas-e2e-[a-f0-9]{32}$/.test(stack ?? "") || !/^[a-f0-9]{32}$/.test(process.env.ATLAS_E2E_MARKER ?? "")) throw new Error("Disposable stack required");
  const args = ["exec", "-i", `${stack}-db-1`, "psql", "-U", "atlas", "-d", "atlas_e2e", "-At", "-v", "ON_ERROR_STOP=1"];
  expect(execFileSync("docker", args, { input: "SELECT marker FROM atlas_e2e_identity", encoding: "utf8" }).trim()).toBe(process.env.ATLAS_E2E_MARKER);
  return execFileSync("docker", args, { input: query, encoding: "utf8" }).trim();
}
async function fixture(page: Page, model = "fixture") {
  const response = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `Partner ${Date.now()}` } });
  expect(response.status()).toBe(201); const { id } = await response.json(); projects.set(page, [...projects.get(page) ?? [], id]);
  const note = await (await page.request.post("/api/knowledge", { data: { project_id: id, title: "計画会議", body: "田中さんが金曜日までに計画を確認する。" } })).json();
  const c = await page.request.post("/api/admin/llm", { data: { name: `Partner ${id}`, provider: "compatible", base_url: "http://llm-mock:8080/v1", model, enabled: true, external_allowed: false, project_ids: [id], max_input_chars: 20000, max_output_tokens: 2048, timeout_seconds: 10, daily_limit: 1000 } });
  expect(c.status()).toBe(200);
  const task = await (await page.request.post("/api/tasks", { data: { project_id: id, name: "計画のレビュー", due_on: "2020-01-01" } })).json();
  return { id, note, task, connection: await c.json() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function generate(request: APIRequestContext, f: Fixture, skill = "project_status", extra = {}) {
  return request.post(`/api/projects/${f.id}/partner`, { data: { skill, request_id: crypto.randomUUID(), ...(skill === "action_extract" ? { note_id: f.note.id, expected_revision: f.note.revision } : {}), ...extra } });
}
function domainSnapshot(id: number) {
  return sql(`SELECT json_build_object('project',(SELECT row_to_json(p) FROM projects p WHERE id=${id}),
    'tasks',(SELECT json_agg(t ORDER BY id) FROM tasks t WHERE project_id=${id}),
    'notes',(SELECT json_agg(k ORDER BY id) FROM project_knowledge k WHERE project_id=${id}),
    'history',(SELECT json_agg(r ORDER BY id) FROM knowledge_revisions r WHERE knowledge_id IN(SELECT id FROM project_knowledge WHERE project_id=${id})),
    'comments',(SELECT json_agg(c ORDER BY id) FROM comments c WHERE task_id IN(SELECT id FROM tasks WHERE project_id=${id})),
    'messages',(SELECT json_agg(m ORDER BY id) FROM project_messages m WHERE project_id=${id}));`);
}
test.beforeEach(async ({ page }) => { expect((await page.request.post("/api/auth/login", { data: login })).status()).toBe(200); });
test.afterEach(async ({ page }) => { await page.goto("about:blank"); for (const id of projects.get(page) ?? []) expect((await page.request.delete(`/api/projects/${id}`)).status()).toBe(200); });

for (const width of [1440, 390]) test(`three read-only skills, references, copy and single panel at ${width}px`, async ({ page, context }) => {
  const f = await fixture(page), before = domainSnapshot(f.id);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]); await page.setViewportSize({ width, height: 1000 });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
  await page.getByRole("menuitem", { name: "アクションを抽出", exact: true }).click();
  const panel = page.locator("[data-project-partner-panel]");
  await expect(panel.locator("[data-partner-action]")).toContainText("計画を確認する");
  await expect(panel.getByRole("button", { name: "別ノートとして保存" })).toHaveCount(0);
  await expect(panel.getByRole("combobox")).toHaveCount(0);
  await panel.getByRole("button", { name: "コピー", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("コピーしました");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("田中さんが金曜日までに計画を確認する。");
  await page.screenshot({ path: test.info().outputPath(`partner-actions-${width}.png`), fullPage: true });
  await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AIアシスト", exact: true })).toBeFocused();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
    await page.getByRole("menuitem", { name: "アクション候補を表示" }).click(); await expect(panel).toHaveCount(1);
    await panel.getByRole("button", { name: "提案を閉じる" }).click();
  }
  await page.goto(`/projects/${f.id}?view=overview`);
  for (const name of ["状況を確認", "週次報告を作成"]) {
    await generateFromOverview(page, name);
    await expect(panel.locator("[data-partner-result]")).toBeVisible();
    await expect(panel).toContainText("期限超過");
    if (name === "週次報告を作成") await expect(panel).toContainText("対象期間");
    await expect(panel.getByRole("link", { name: "確認時点の集計", exact: true }).first()).toHaveAttribute("href", `/projects/${f.id}?view=list`);
  }
  await page.screenshot({ path: test.info().outputPath(`partner-weekly-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(domainSnapshot(f.id)).toBe(before); expect(errors).toEqual([]);
});

test("SQL facts respect JST dates, completion period, multi-home and deleted/private scope", async ({ page }) => {
  const f = await fixture(page), hidden = await fixture(page);
  sql(`UPDATE tasks SET name='PRIVATE_ONLY' WHERE id=${hidden.task.id};
    INSERT INTO tasks(project_id,name,due_on) VALUES(${f.id},'today',(now() AT TIME ZONE 'Asia/Tokyo')::date),(${f.id},'last day',(now() AT TIME ZONE 'Asia/Tokyo')::date+6),(${f.id},'outside',(now() AT TIME ZONE 'Asia/Tokyo')::date+7);
    INSERT INTO tasks(project_id,name,completed,completed_at) VALUES(${f.id},'done recently',true,now()-interval '1 day'),(${f.id},'done old',true,now()-interval '8 days');
    INSERT INTO tasks(project_id,name,deleted_at) VALUES(${f.id},'DELETED_TASK',now());
    INSERT INTO project_knowledge(project_id,title,body,deleted_at) VALUES(${f.id},'DELETED_NOTE','secret',now());
    INSERT INTO task_dependencies(task_id,depends_on_id) VALUES(${f.task.id},${hidden.task.id});`);
  const response = await generate(page.request, f); expect(response.status(), await response.text()).toBe(200);
  const value = await response.json(); expect(value.facts).toMatchObject({ total: 6, completed: 2, overdue: 1, unassigned: 4, completed_in_period: 1, due_next_week: 2 });
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE_ONLY|DELETED_TASK|DELETED_NOTE/); expect(value.coverage.dependencies).toBe(0);
  sql(`INSERT INTO task_project_memberships(task_id,project_id) VALUES(${hidden.task.id},${f.id});`);
  const shared = await (await generate(page.request, f)).json(); expect(shared.facts.total).toBe(7); expect(shared.coverage.dependencies).toBe(1);
  expect(shared.sources.some((s: { id: string }) => s.id === `T${hidden.task.id}`)).toBe(true);
  const weekly = await (await generate(page.request, f, "weekly_report")).json();
  expect(new Date(weekly.checked_at).getTime()-new Date(weekly.period_start).getTime()).toBe(7*86400000);
});

test("viewers, outsiders and revoked editors cannot receive project data", async ({ page, browser }) => {
  const f = await fixture(page, "slow"), other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await other.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: login.password } });
    expect((await generate(other.request, f)).status()).toBe(403);
    await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } });
    expect((await generate(other.request, f, "action_extract")).status()).toBe(403);
    await page.request.patch(`/api/projects/${f.id}/members/2`, { data: { role: "editor" } });
    const pending = generate(other.request, f); await page.waitForTimeout(500);
    await page.request.delete(`/api/projects/${f.id}/members/2`); expect((await pending).status()).toBe(403);
  } finally { await other.close(); }
});

test("selected-note isolation, deleted sources, request validation and no write operation", async ({ page }) => {
  const f = await fixture(page), other = await fixture(page);
  expect((await generate(page.request, f, "action_extract", { note_id: other.note.id })).status()).toBe(404);
  expect((await generate(page.request, f, "action_extract", { expected_revision: 999 })).status()).toBe(409);
  for (const extra of [{ model: "override" }, { user_id: 2 }, { note_id: other.note.id }, { skill: "execute" }]) expect((await generate(page.request, f, "project_status", extra)).status()).toBe(400);
  expect((await page.request.put(`/api/projects/${f.id}/partner`, { data: {} })).status()).toBe(405);
  await page.request.delete(`/api/knowledge/${f.note.id}?revision=${f.note.revision}`);
  expect((await generate(page.request, f, "action_extract")).status()).toBe(404);
});

test("changed data/config discards results; old and new AI share concurrency quota", async ({ page }) => {
  const f = await fixture(page, "slow");
  let pending = generate(page.request, f); await page.waitForTimeout(500);
  expect((await page.request.post(`/api/knowledge/${f.note.id}/ai`, { data: { operation: "summary", expected_revision: f.note.revision, request_id: crypto.randomUUID() } })).status()).toBe(429);
  sql(`UPDATE tasks SET name='変更された計画' WHERE id=${f.task.id}`);
  expect((await pending).status()).toBe(409);
  pending = generate(page.request, f); await page.waitForTimeout(500);
  await page.request.post("/api/admin/llm", { data: { ...f.connection, model: "fixture" } });
  expect((await pending).status()).toBe(409);
  const request_id = crypto.randomUUID();
  expect((await generate(page.request, f, "project_status", { request_id })).status()).toBe(200);
  expect((await generate(page.request, f, "project_status", { request_id })).status()).toBe(409);
});

test("invalid output fails closed, HTML is inert and cancellation/switching never appends panels", async ({ page }) => {
  const f = await fixture(page, "bad-json"); let c = f.connection;
  for (const model of ["bad-json", "unknown-source"]) {
    c = await (await page.request.post("/api/admin/llm", { data: { ...c, model } })).json();
    expect((await generate(page.request, f)).status()).toBe(502);
  }
  c = await (await page.request.post("/api/admin/llm", { data: { ...c, model: "html" } })).json();
  await page.goto(`/projects/${f.id}?view=overview`); await generateFromOverview(page, "状況を確認");
  await expect(page.locator("[data-partner-summary]")).toContainText("<script>");
  expect(await page.evaluate(() => "partnerInjected" in window)).toBe(false); await expect(page.locator("[data-partner-result] img")).toHaveCount(0);
  c = await (await page.request.post("/api/admin/llm", { data: { ...c, model: "slow" } })).json();
  await generateFromOverview(page, "状況を確認");
  await page.getByRole("button", { name: "中止", exact: true }).click();
  await expect(page.locator("[data-partner-result]")).toHaveCount(0);
  await expect(page.locator("[data-project-partner-panel]")).toContainText("中止しました");
  await page.waitForTimeout(2700);
  const another = await (await page.request.post("/api/knowledge", { data: { project_id: f.id, title: "別ノート", body: "別の本文" } })).json();
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.note.id}`);
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click(); await page.getByRole("menuitem", { name: "アクションを抽出" }).click();
  await expect(page.getByRole("button", { name: "中止", exact: true })).toBeVisible();
  await page.locator(`[data-knowledge-note="${another.id}"]`).click(); await page.waitForTimeout(2700);
  await expect(page.locator("[data-project-partner-panel]")).toHaveCount(0);
  expect(await (await page.request.get(`/api/knowledge/${f.note.id}`)).json()).toEqual(f.note);
});

test("bounded coverage is explicit and disabled/input-limited settings stop generation", async ({ page }) => {
  const f = await fixture(page);
  sql(`INSERT INTO tasks(project_id,name,description) SELECT ${f.id},'task '||n,repeat('x',600) FROM generate_series(1,105) n;`);
  const r = await generate(page.request, f); expect(r.status(), await r.text()).toBe(200);
  const result = await r.json(); expect(result.coverage.partial).toBe(true); expect(result.coverage.total_tasks).toBe(106); expect(result.coverage.tasks).toBeLessThan(100);
  const c = await (await page.request.post("/api/admin/llm", { data: { ...f.connection, max_input_chars: 100 } })).json();
  expect((await generate(page.request, f)).status()).toBe(400);
  await page.request.post("/api/admin/llm", { data: { ...c, max_input_chars: 20000, enabled: false } });
  expect((await generate(page.request, f)).status()).toBe(403);
});
