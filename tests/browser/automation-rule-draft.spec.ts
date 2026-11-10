import { expect, test, type Page } from "@playwright/test";
import type { ProjectRule, RuleDefinition } from "../../lib/automation/types";

const branchDefinition: RuleDefinition = {
  version: 1,
  triggers: [{ event: "task.manual_rule" }],
  conditions: [{ field: "task.name", op: "contains", value: "global filter" }],
  branches: [
    { name: "conditional path", else: false, conditions: [{ field: "task.name", op: "eq", value: "selected task" }],
      actions: [{ capability: "task.add_comment", params: { body: "conditional comment" } }] },
    { name: "fallback path", conditions: [], else: true,
      actions: [{ capability: "task.add_comment", params: { body: "fallback comment" } }] },
  ],
};

async function fixture(page: Page, definition = branchDefinition) {
  const login = await page.request.post("/api/auth/login", { data: {
    email: process.env.E2E_EMAIL ?? "admin@example.com",
    password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
  } });
  expect(login.ok()).toBeTruthy();
  const projectResponse = await page.request.post("/api/projects", { data: {
    workspace_id: 1, name: `AR06 AR08 browser ${Date.now()} ${test.info().testId}`,
  } });
  expect(projectResponse.status()).toBe(201);
  const { id: projectId } = await projectResponse.json() as { id: number };
  const response = await page.request.post(`/api/projects/${projectId}/rules`, { data: {
    name: "draft regression rule", description: "original description", definition,
  } });
  expect(response.status()).toBe(201);
  const { id: ruleId } = await response.json() as { id: number };
  return { projectId, ruleId };
}

async function openEditor(page: Page, projectId: number, ruleId: number) {
  await page.goto(`/projects/${projectId}?view=list`);
  await page.locator("[data-project-customize]").click();
  const drawer = page.locator("[data-project-customize-drawer]");
  await drawer.getByRole("button", { name: /AIと自動化/ }).click();
  await drawer.locator(`[data-automation-rule="${ruleId}"]`).getByRole("button", { name: "編集", exact: true }).click();
  return page.getByRole("dialog", { name: "ルールを編集" });
}

async function latestRule(page: Page, projectId: number, ruleId: number) {
  const response = await page.request.get(`/api/projects/${projectId}/rules`);
  expect(response.ok()).toBeTruthy();
  const { rules } = await response.json() as { rules: ProjectRule[] };
  return rules.find((rule) => rule.id === ruleId)!;
}

test("branch off/on preserves all paths and conditions when saved", async ({ page }) => {
  const { projectId, ruleId } = await fixture(page);
  const editor = await openEditor(page, projectId, ruleId);
  const mode = editor.getByRole("checkbox", { name: "条件分岐を使う（elseパス対応）" });
  await editor.getByRole("textbox", { name: "パス名", exact: true }).first().fill("edited conditional path");
  await mode.uncheck();
  await mode.check();
  await expect(editor.getByRole("textbox", { name: "パス名", exact: true }).first()).toHaveValue("edited conditional path");
  await expect(editor.getByRole("textbox", { name: "パス名", exact: true }).nth(1)).toHaveValue("fallback path");
  await expect(editor.getByRole("checkbox", { name: "elseパス", exact: true }).nth(1)).toBeChecked();
  const saved = page.waitForResponse((response) => response.url().endsWith(`/rules/${ruleId}`) && response.request().method() === "PATCH");
  await editor.getByRole("button", { name: "変更を保存", exact: true }).click();
  expect((await saved).status()).toBe(200);
  const latest = await latestRule(page, projectId, ruleId);
  expect(latest.definition.branches).toEqual([
    { ...branchDefinition.branches![0], name: "edited conditional path" }, branchDefinition.branches![1],
  ]);
  expect(latest.definition.conditions).toEqual(branchDefinition.conditions);
  expect(latest.definition.actions).toBeUndefined();
});

test("a delayed AI suggestion waits for explicit application and replaces branch mode atomically", async ({ page }) => {
  const { projectId, ruleId } = await fixture(page);
  const editor = await openEditor(page, projectId, ruleId);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route(`**/api/projects/${projectId}/rules/ai-suggest`, async (route) => {
    started();
    await pending;
    await route.fulfill({ json: {
      name: "AI replacement", description: "AI description", definition: {
        version: 1, triggers: [{ event: "task.completed" }], conditions: [],
        actions: [{ capability: "task.add_comment", params: { body: "AI body" } }],
      },
    } });
  });
  await editor.getByPlaceholder("例: 新規タスクを進行中にして担当者を田中さんにする").fill("make a new flat rule");
  await editor.getByRole("button", { name: "提案", exact: true }).click();
  await requested;
  await editor.getByRole("textbox", { name: "ルール名", exact: true }).fill("newer manual draft");
  release();
  const apply = editor.getByRole("button", { name: "AIの提案を適用", exact: true });
  await expect(apply).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("newer manual draft");
  await expect(editor.getByRole("checkbox", { name: "条件分岐を使う（elseパス対応）" })).toBeChecked();
  await apply.click();
  await expect(editor.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("AI replacement");
  await expect(editor.getByRole("checkbox", { name: "条件分岐を使う（elseパス対応）" })).not.toBeChecked();
  const saved = page.waitForResponse((response) => response.url().endsWith(`/rules/${ruleId}`) && response.request().method() === "PATCH");
  await editor.getByRole("button", { name: "変更を保存", exact: true }).click();
  expect((await saved).status()).toBe(200);
  const latest = await latestRule(page, projectId, ruleId);
  expect(latest.description).toBe("AI description");
  expect(latest.definition).toEqual({
    version: 1, triggers: [{ event: "task.completed" }], conditions: [],
    actions: [{ capability: "task.add_comment", params: { body: "AI body" } }],
  });
});

test("two editors preserve the stale draft on 409 and can explicitly reload latest", async ({ page, context }) => {
  const { projectId, ruleId } = await fixture(page);
  const original = await latestRule(page, projectId, ruleId);
  const first = await openEditor(page, projectId, ruleId);
  const otherPage = await context.newPage();
  const second = await openEditor(otherPage, projectId, ruleId);
  await first.getByRole("textbox", { name: "説明（任意）", exact: true }).fill("first editor description");
  const firstSave = page.waitForResponse((response) => response.url().endsWith(`/rules/${ruleId}`) && response.request().method() === "PATCH");
  await first.getByRole("button", { name: "変更を保存", exact: true }).click();
  expect((await firstSave).status()).toBe(200);
  expect((await latestRule(page, projectId, ruleId)).version).toBe(original.version);

  await second.getByRole("textbox", { name: "ルール名", exact: true }).fill("second editor draft");
  const rejected = otherPage.waitForResponse((response) => response.url().endsWith(`/rules/${ruleId}`) && response.request().method() === "PATCH");
  await second.getByRole("button", { name: "変更を保存", exact: true }).click();
  expect((await rejected).status()).toBe(409);
  await expect(second.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue("second editor draft");
  await expect(second.getByRole("button", { name: "変更を保存", exact: true })).toBeDisabled();
  expect((await latestRule(page, projectId, ruleId)).description).toBe("first editor description");

  await second.getByRole("button", { name: "最新のルールを読み込む（編集中の内容を破棄）", exact: true }).click();
  await expect(second.getByRole("textbox", { name: "説明（任意）", exact: true })).toHaveValue("first editor description");
  await expect(second.getByRole("textbox", { name: "ルール名", exact: true })).toHaveValue(original.name);
  await second.getByRole("textbox", { name: "ルール名", exact: true }).fill("second editor saved after reload");
  const accepted = otherPage.waitForResponse((response) => response.url().endsWith(`/rules/${ruleId}`) && response.request().method() === "PATCH");
  await second.getByRole("button", { name: "変更を保存", exact: true }).click();
  expect((await accepted).status()).toBe(200);
  const latest = await latestRule(page, projectId, ruleId);
  expect(latest.name).toBe("second editor saved after reload");
  expect(latest.description).toBe("first editor description");
  expect(latest.version).toBe(original.version);
  await otherPage.close();
});
