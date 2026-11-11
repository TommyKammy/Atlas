import { expect, test, type Page } from "@playwright/test";
import type { RuleDefinition } from "../../lib/automation/types";

const flat: RuleDefinition = { version: 1, triggers: [{ event: "task.manual_rule" }], actions: [
  { capability: "task.add_comment", params: { body: "published first" } },
  { capability: "task.add_comment", params: { body: "published second" } },
] };

async function fixture(page: Page, definition = flat) {
  const login = await page.request.post("/api/auth/login", { data: {
    email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
  } });
  expect(login.ok()).toBeTruthy();
  const created = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `Workflow ${test.info().testId} ${Date.now()}` } });
  expect(created.status()).toBe(201);
  const { id: projectId } = await created.json() as { id: number };
  const rule = await page.request.post(`/api/projects/${projectId}/rules`, { data: { name: "Workflow original", definition } });
  expect(rule.status()).toBe(201);
  const { id: ruleId } = await rule.json() as { id: number };
  const taskName = `Workflow sample ${test.info().testId}`;
  const task = await page.request.post("/api/tasks", { data: { project_id: projectId, name: taskName } });
  expect(task.status()).toBe(201);
  const { id: taskId } = await task.json() as { id: number };
  return { projectId, ruleId, taskName, taskId, path: `/projects/${projectId}/rules/${ruleId}`, base: `/api/projects/${projectId}/rules` };
}

async function source(page: Page, projectId: number, ruleId: number) {
  const response = await page.request.get(`/api/projects/${projectId}/rules`);
  expect(response.ok()).toBeTruthy();
  const { rules } = await response.json() as { rules: { id: number; name: string; definition: RuleDefinition }[] };
  return rules.find((rule) => rule.id === ruleId)!;
}

async function savedDraft(page: Page, base: string, ruleId: number) {
  const response = await page.request.get(`${base}/drafts?rule_id=${ruleId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { draft: { id: string; name: string; revision: number; definition: RuleDefinition } | null }).draft;
}

test("workflow editor saves a separate draft, restores it and publishes its exact contents", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await expect(page.locator("[data-rule-workflow-editor]")).toBeVisible();
  await page.getByRole("textbox", { name: "ルール名", exact: true }).fill("Workflow draft name");
  await page.locator('[data-rule-node="action-flat-0"]').click();
  await page.locator("[data-rule-action-fields] textarea").fill("draft {{task.name}}");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect.poll(async () => (await savedDraft(page, f.base, f.ruleId))?.name).toBe("Workflow draft name");
  expect((await source(page, f.projectId, f.ruleId)).name).toBe("Workflow original");
  expect((await source(page, f.projectId, f.ruleId)).definition.actions![0].params.body).toBe("published first");
  await expect(page.locator("[data-rule-save-status]")).toHaveText("✓ 保存済み");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("Workflow draft name");
  const published = page.waitForResponse((response) => response.url().endsWith("/publish"));
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  expect((await published).status()).toBe(200);
  await expect.poll(async () => (await source(page, f.projectId, f.ruleId)).name).toBe("Workflow draft name");
  expect((await source(page, f.projectId, f.ruleId)).definition.actions![0].params.body).toBe("draft {{task.name}}");
  await expect(page.getByText("公開済み", { exact: true })).toBeVisible();
});

test("a new workflow has a restorable URL, inserts a named variable and publishes once", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/projects/${f.projectId}/rules/new`);
  await page.getByRole("button", { name: "テンプレート", exact: true }).click();
  await page.getByRole("button", { name: "完了時にコメントする", exact: true }).click();
  await page.getByRole("textbox", { name: "ルール名", exact: true }).fill("New named workflow");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(page).toHaveURL(/\/rules\/new\?draft=/);
  await expect(page.locator("[data-rule-save-status]")).toHaveText("✓ 保存済み");
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("New named workflow");
  await page.locator("[data-rule-workflow-editor] header").getByRole("link").first().click();
  await page.locator("[data-project-customize]").click();
  const drawer = page.locator("[data-project-customize-drawer]");
  await drawer.getByRole("button", { name: /AIと自動化/ }).click();
  const draftPath = new URL(url).pathname + new URL(url).search;
  await drawer.locator(`[data-rule-draft-list] a[href="${draftPath}"]`).click();
  await expect(page.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("New named workflow");
  await page.locator('[data-rule-node="action-flat-0"]').click();
  await page.getByText("変数を挿入", { exact: true }).click();
  await page.locator("[data-rule-inspector]").getByRole("button", { name: "タスク名 タスク", exact: true }).click();
  await expect(page.locator('[data-rule-node="action-flat-0"]')).toContainText("［タスク名］");
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${f.projectId}/rules/\\d+$`));
  const response = await page.request.get(f.base);
  const data = await response.json() as { rules: { name: string }[] };
  expect(data.rules.filter((rule) => rule.name === "New named workflow")).toHaveLength(1);
});

test("two workflow tabs keep the conflicting draft and explicitly reload the current revision", async ({ page, context }) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await page.getByRole("textbox", { name: "ルール名", exact: true }).fill("Initial server draft");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect.poll(async () => (await savedDraft(page, f.base, f.ruleId))?.name).toBe("Initial server draft");
  const other = await context.newPage();
  await other.goto(f.path);
  await expect(other.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("Initial server draft");
  await page.getByRole("textbox", { name: "ルール名", exact: true }).fill("First tab current");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect.poll(async () => (await savedDraft(page, f.base, f.ruleId))?.name).toBe("First tab current");
  await other.getByRole("textbox", { name: "ルール名", exact: true }).fill("Second tab unsaved");
  await other.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(other.locator("[data-rule-workflow-editor]").getByRole("alert")).toContainText("編集中の内容は保持しています");
  await expect(other.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("Second tab unsaved");
  await expect(other.getByRole("button", { name: "公開する", exact: true })).toBeDisabled();
  await other.getByRole("button", { name: "最新の下書きを読み込む（編集内容を破棄）", exact: true }).click();
  await other.locator("[data-confirm-ok]").click();
  await expect(other.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("First tab current");
  await expect(other.locator("[data-rule-workflow-editor]").getByRole("alert")).toHaveCount(0);
  await other.close();
});

test("preview displays the chosen branch and history displays real execution decisions", async ({ page }) => {
  const f = await fixture(page, { version: 1, triggers: [{ event: "task.manual_rule" }], branches: [
    { name: "First matching path", conditions: [{ field: "task.name", op: "contains", value: "Workflow sample" }], actions: [{ capability: "task.add_comment", params: { body: "Preview {{task.name}}" } }] },
    { name: "Fallback path", else: true, conditions: [], actions: [{ capability: "task.complete", params: {} }] },
  ] });
  await page.goto(f.path);
  await page.getByRole("button", { name: "▷ テスト", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ルールをテスト", exact: true });
  await dialog.getByRole("combobox", { name: "テスト対象タスク" }).fill(f.taskName);
  await dialog.getByRole("option", { name: new RegExp(f.taskName) }).click();
  const response = page.waitForResponse((result) => result.url().endsWith("/rules/preview"));
  await dialog.getByRole("button", { name: "変更せずにテスト", exact: true }).click();
  const preview = await (await response).json() as { trace: { selected_branch: number } };
  expect(preview.trace.selected_branch).toBe(0);
  await expect(dialog.locator("[data-rule-preview-result]")).toContainText("選択されたパス · First matching path");
  await expect(dialog.locator("[data-rule-preview-result]")).toContainText(`Preview ${f.taskName}`);
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  const actual = await page.request.post(`${f.base}/${f.ruleId}/run`, { data: { task_id: f.taskId } });
  expect(actual.status()).toBe(201);
  await page.getByRole("button", { name: "実行履歴", exact: true }).click();
  const history = page.getByRole("region", { name: "ルールの実行履歴" });
  await history.locator("summary").first().click();
  await expect(history).toContainText("選択されたパス · First matching path");
  await expect(history).toContainText("✓ 成功");
});

test("action reordering and undo preserve the original published workflow", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await page.locator('[data-rule-node="action-flat-1"]').click();
  await page.locator("[data-rule-inspector]").getByRole("button", { name: "上へ", exact: true }).click();
  await expect(page.locator('[data-rule-node="action-flat-0"]')).toContainText("published second");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(page.locator('[data-rule-node="action-flat-0"]')).toContainText("published first");
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(page.locator('[data-rule-node="action-flat-0"]')).toContainText("published second");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect.poll(async () => (await savedDraft(page, f.base, f.ruleId))?.definition.actions?.[0].params.body).toBe("published second");
  expect((await source(page, f.projectId, f.ruleId)).definition.actions![0].params.body).toBe("published first");
});

test("internal navigation flushes a just-edited draft before the autosave delay", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await page.getByRole("textbox", { name: "ルール名", exact: true }).fill("Navigated immediately");
  await page.locator("[data-rule-workflow-editor] header").getByRole("link").first().click();
  await expect(page).toHaveURL((url) => url.pathname === `/projects/${f.projectId}` && url.searchParams.get("view") === "list" && url.searchParams.get("list_state") === "1" && !url.searchParams.has("task") && !url.searchParams.has("dashboard"));
  await expect(page.locator("[data-list-view]")).toBeVisible();
  await expect.poll(async () => (await savedDraft(page, f.base, f.ruleId))?.name).toBe("Navigated immediately");
});

test("publishing blocks keyboard undo until the exact submitted draft is published", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await page.getByRole("textbox", { name: "ルール名", exact: true }).fill("Exact publication");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/rules/drafts/*/publish", async (route) => { await pending; await route.continue(); });
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page.getByRole("button", { name: "公開中…", exact: true })).toBeDisabled();
  await page.locator('[data-rule-node="trigger-0"]').focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("Exact publication");
  release();
  await expect(page.getByText("公開済み", { exact: true })).toBeVisible();
  expect((await source(page, f.projectId, f.ruleId)).name).toBe("Exact publication");
});

test("the workflow keeps Atlas styling and the inspector remains operable on narrow screens", async ({ page }) => {
  const f = await fixture(page, { version: 1, triggers: [{ event: "form.submitted" }], branches: [
    { name: "優先対応", conditions: [{ field: "task.status", op: "eq", value: "進行中" }], actions: [{ capability: "task.assign", params: { user_id: 2 } }, { capability: "task.set_due_date", params: { offset_days: 1 } }] },
    { name: "それ以外", else: true, conditions: [], actions: [{ capability: "task.add_comment", params: { body: "受け付けました" } }] },
  ] });
  expect((await page.request.patch(`/api/projects/${f.projectId}`, { data: { name: "問い合わせワークフロー" } })).ok()).toBeTruthy();
  expect((await page.request.patch(`${f.base}/${f.ruleId}`, { data: { name: "問い合わせの自動振り分け" } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(f.path);
  await page.locator('[data-rule-node="action-0-0"]').click();
  await expect(page.locator("[data-rule-inspector]")).toBeVisible();
  await expect(page.locator('[data-rule-node="trigger-0"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-rule-inspector]").getByRole("combobox", { name: "担当者" })).toHaveValue(/田中/);
  await page.screenshot({ path: test.info().outputPath("rule-editor-desktop.png") });
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByRole("button", { name: "設定パネルを閉じる", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定パネルを閉じる", exact: true }).click();
  await page.locator('[data-rule-node="trigger-0"]').click();
  await expect(page.locator("[data-rule-inspector]")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath("rule-editor-narrow.png") });
});

test("conflict recovery cancels queued stale saves before loading the latest revision", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await page.getByRole("textbox", { name: "ルール名", exact: true }).fill("Initial queue draft");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect.poll(async () => (await savedDraft(page, f.base, f.ruleId))?.name).toBe("Initial queue draft");
  await expect(page.locator("[data-rule-save-status]")).toHaveText("✓ 保存済み");
  const current = (await savedDraft(page, f.base, f.ruleId))!;
  await page.clock.install();
  let release!: () => void;
  let started!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  let writes = 0;
  await page.route(`**/rules/drafts/${current.id}`, async (route) => {
    if (route.request().method() !== "PUT") { await route.continue(); return; }
    writes += 1;
    if (writes === 1) { started(); await delayed; await route.fulfill({ status: 409, json: { error: "concurrent draft update", code: "draft_conflict" } }); }
    else await route.continue();
  });
  for (const name of ["Queued one", "Queued two", "Queued three"]) {
    await page.getByRole("textbox", { name: "ルール名", exact: true }).fill(name);
    await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  }
  await requested;
  const external = await page.request.put(`${f.base}/drafts/${current.id}`, { data: { expected_revision: current.revision, name: "External current draft" } });
  expect(external.ok()).toBeTruthy();
  release();
  await expect(page.locator("[data-rule-workflow-editor]").getByRole("alert")).toContainText("編集中の内容は保持しています");
  await page.getByRole("button", { name: "最新の下書きを読み込む（編集内容を破棄）", exact: true }).click();
  await page.locator("[data-confirm-ok]").click();
  await expect(page.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("External current draft");
  await page.clock.runFor(4000);
  expect(writes).toBe(1);
  expect((await savedDraft(page, f.base, f.ruleId))?.name).toBe("External current draft");
});

test("discarding a draft keeps the published rule and does not recreate the discarded draft", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await page.getByRole("textbox", { name: "ルール名", exact: true }).fill("Draft to discard");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect.poll(async () => (await savedDraft(page, f.base, f.ruleId))?.name).toBe("Draft to discard");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "下書きを破棄", exact: true }).click();
  await page.locator("[data-confirm-ok]").click();
  await expect(page).toHaveURL((url) => url.pathname === `/projects/${f.projectId}` && url.searchParams.get("view") === "list" && url.searchParams.get("list_state") === "1" && !url.searchParams.has("task") && !url.searchParams.has("dashboard"));
  await expect(page.locator("[data-list-view]")).toBeVisible();
  await expect.poll(async () => await savedDraft(page, f.base, f.ruleId)).toBeNull();
  expect((await source(page, f.projectId, f.ruleId)).name).toBe("Workflow original");
});
