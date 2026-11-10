import { expect, test, type Page } from "@playwright/test";
import type { RuleDefinition } from "../../lib/automation/types";

const definition: RuleDefinition = {
  version: 1,
  triggers: [{ event: "task.completed" }],
  conditions: [],
  actions: [{ capability: "task.set_status", params: { status: "完了" } }],
};

async function fixture(page: Page, ruleDefinition = definition) {
  const login = await page.request.post("/api/auth/login", { data: {
    email: process.env.E2E_EMAIL ?? "admin@example.com",
    password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
  } });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post("/api/projects", { data: {
    workspace_id: 1, name: `Condition validation ${test.info().testId} ${Date.now()}`,
  } });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  const base = `/api/projects/${projectId}/rules`;
  const created = await page.request.post(base, { data: {
    name: "Status Done validation", definition: ruleDefinition,
  } });
  expect(created.status()).toBe(201);
  const { id: ruleId } = await created.json() as { id: number };
  return { projectId, ruleId, base, path: `/projects/${projectId}/rules/${ruleId}` };
}

async function live(page: Page, base: string, ruleId: number) {
  const response = await page.request.get(base);
  expect(response.ok()).toBeTruthy();
  const { rules } = await response.json() as { rules: { id: number; definition: RuleDefinition }[] };
  return rules.find((rule) => rule.id === ruleId)!;
}

async function draft(page: Page, base: string, ruleId: number) {
  const response = await page.request.get(`${base}/drafts?rule_id=${ruleId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { draft: { definition: RuleDefinition } | null }).draft;
}

async function closeInspector(page: Page) {
  const close = page.getByRole("button", { name: "設定パネルを閉じる", exact: true });
  if (await close.isVisible()) await close.click();
}

test("an unfinished common condition stays in its draft and blocks publication with an accessible repair link", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto(f.path);
  await closeInspector(page);
  await page.locator('[data-rule-node="conditions"]').click();
  await page.getByRole("button", { name: "条件を追加", exact: true }).click();

  const summary = page.locator("[data-rule-validation-summary]");
  const publish = page.getByRole("button", { name: "公開する", exact: true });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(/条件/);
  await expect(publish).toBeDisabled();
  const row = page.locator('[data-rule-condition-index="0"]');
  const value = row.getByLabel("比較する値", { exact: true });
  await expect(value).toHaveAttribute("aria-invalid", "true");
  const errorId = await value.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  await expect(page.locator(`[id="${errorId}"]`)).toContainText(/入力/);

  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect.poll(async () => (await draft(page, f.base, f.ruleId))?.definition.conditions?.length).toBe(1);
  expect((await live(page, f.base, f.ruleId)).definition.conditions).toEqual([]);
  await page.reload();
  await expect(summary).toBeVisible();
  await expect(publish).toBeDisabled();
  await summary.getByRole("button").first().click();
  await expect(value).toBeFocused();
  await value.fill(" \t ");
  await expect(publish).toBeDisabled();
  await value.fill("確認対象タスク");
  await expect(summary).toHaveCount(0);
  await expect(value).not.toHaveAttribute("aria-invalid", "true");
  await expect(publish).toBeEnabled();
  const published = page.waitForResponse((response) => response.url().endsWith("/publish"));
  await publish.click();
  expect((await published).status()).toBe(200);
  expect((await live(page, f.base, f.ruleId)).definition.conditions?.[0].value).toBe("確認対象タスク");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath("condition-validation-repaired.png") });
});

test("empty checks do not require a value and deleting a condition restores an unconditional workflow", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(f.path);
  await closeInspector(page);
  await page.locator('[data-rule-node="conditions"]').click();
  await page.getByRole("button", { name: "条件を追加", exact: true }).click();
  const inspector = page.locator("[data-rule-inspector]");
  const publish = page.getByRole("button", { name: "公開する", exact: true });
  await expect(publish).toBeDisabled();
  for (const op of ["is_empty", "is_not_empty"]) {
    await inspector.getByRole("combobox", { name: "比較方法", exact: true }).selectOption(op);
    await expect(page.locator("[data-rule-condition-error]")).toHaveCount(0);
    await expect(page.locator("[data-rule-validation-summary]")).toHaveCount(0);
    await expect(inspector.getByLabel("比較する値", { exact: true })).toHaveCount(0);
    await expect(publish).toBeEnabled();
    const published = page.waitForResponse((response) => response.url().endsWith("/publish"));
    await publish.click();
    expect((await published).status()).toBe(200);
    expect((await live(page, f.base, f.ruleId)).definition.conditions?.[0].op).toBe(op);
  }
  await inspector.getByRole("button", { name: "条件1を削除", exact: true }).click();
  const published = page.waitForResponse((response) => response.url().endsWith("/publish"));
  await publish.click();
  expect((await published).status()).toBe(200);
  expect((await live(page, f.base, f.ruleId)).definition.conditions).toEqual([]);
});

test("branch warnings locate the unfinished condition without losing the valid condition", async ({ page }) => {
  const f = await fixture(page, {
    version: 1, triggers: definition.triggers,
    branches: [{ name: "対象タスク", conditions: [{ field: "task.name", op: "contains", value: "確認" }],
      actions: definition.actions! }],
  });
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto(f.path);
  await closeInspector(page);
  await page.locator('[data-rule-node="branch-0"]').click();
  await page.getByRole("button", { name: "条件を追加", exact: true }).click();
  const summary = page.locator("[data-rule-validation-summary]");
  await expect(summary).toContainText("対象タスク");
  const publish = page.getByRole("button", { name: "公開する", exact: true });
  await expect(publish).toBeDisabled();
  await closeInspector(page);
  await summary.getByRole("button").first().click();
  const value = page.locator('[data-rule-condition-index="1"]').getByLabel("比較する値", { exact: true });
  await expect(value).toBeFocused();
  await expect(value).toHaveAttribute("aria-invalid", "true");
  await value.fill("対象のタスク");
  await expect(summary).toHaveCount(0);
  const published = page.waitForResponse((response) => response.url().endsWith("/publish"));
  await publish.click();
  expect((await published).status()).toBe(200);
  const branch = (await live(page, f.base, f.ruleId)).definition.branches![0];
  expect(branch.conditions).toHaveLength(2);
  expect(branch.conditions[0].value).toBe("確認");
  expect(branch.conditions[1].value).toBe("対象のタスク");
});

test("zero and false remain valid condition values in the editor", async ({ page }) => {
  const conditions: RuleDefinition["conditions"] = [
    { field: "task.progress", op: "eq", value: 0 },
    { field: "task.completed", op: "eq", value: false },
  ];
  const f = await fixture(page, { ...definition, conditions });
  await page.goto(f.path);
  await expect(page.locator("[data-rule-validation-summary]")).toHaveCount(0);
  const publish = page.getByRole("button", { name: "公開する", exact: true });
  await expect(publish).toBeEnabled();
  const published = page.waitForResponse((response) => response.url().endsWith("/publish"));
  await publish.click();
  expect((await published).status()).toBe(200);
  expect((await live(page, f.base, f.ruleId)).definition.conditions).toEqual(conditions);
});

test("a legacy fallback draft can explicitly clear its hidden unfinished conditions", async ({ page }) => {
  const f = await fixture(page, {
    version: 1, triggers: definition.triggers,
    branches: [{ name: "それ以外", else: true, conditions: [], actions: definition.actions! }],
  });
  const created = await page.request.post(`${f.base}/drafts`, { data: { rule_id: f.ruleId } });
  expect(created.status()).toBe(201);
  const { draft: pending } = await created.json() as { draft: { id: string; revision: number } };
  const saved = await page.request.put(`${f.base}/drafts/${pending.id}`, { data: {
    expected_revision: pending.revision,
    definition: { version: 1, triggers: definition.triggers, branches: [{
      name: "それ以外", else: true, conditions: [{ field: "task.name", op: "eq", value: "" }],
      actions: definition.actions!,
    }] },
  } });
  expect(saved.ok()).toBeTruthy();
  await page.goto(f.path);
  const summary = page.locator("[data-rule-validation-summary]");
  await expect(summary).toContainText("それ以外");
  await expect(page.getByRole("button", { name: "公開する", exact: true })).toBeDisabled();
  await summary.getByRole("button").first().click();
  const clear = page.getByRole("button", { name: "残っている条件を削除", exact: true });
  await expect(clear).toBeFocused();
  await clear.click();
  await expect(summary).toHaveCount(0);
  const published = page.waitForResponse((response) => response.url().endsWith("/publish"));
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  expect((await published).status()).toBe(200);
  expect((await live(page, f.base, f.ruleId)).definition.branches![0].conditions).toEqual([]);
});

test("a saved draft with an unknown field warns before publication and can be repaired", async ({ page }) => {
  const f = await fixture(page);
  const created = await page.request.post(`${f.base}/drafts`, { data: { rule_id: f.ruleId } });
  expect(created.status()).toBe(201);
  const { draft: pending } = await created.json() as { draft: { id: string; revision: number } };
  const saved = await page.request.put(`${f.base}/drafts/${pending.id}`, { data: {
    expected_revision: pending.revision,
    definition: { ...definition, conditions: [{ field: "task.typo", op: "eq", value: "filled" }] },
  } });
  expect(saved.ok()).toBeTruthy();
  await page.goto(f.path);
  const summary = page.locator("[data-rule-validation-summary]");
  await expect(summary).toContainText("条件の項目を選択");
  await expect(page.getByRole("button", { name: "公開する", exact: true })).toBeDisabled();
  await summary.getByRole("button").first().click();
  await page.locator("[data-rule-inspector]").getByRole("combobox", { name: "条件の項目", exact: true }).selectOption("task.name");
  await page.locator('[data-rule-condition-index="0"]').getByLabel("比較する値", { exact: true }).fill("修正したタスク名");
  await expect(summary).toHaveCount(0);
  const published = page.waitForResponse((response) => response.url().endsWith("/publish"));
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  expect((await published).status()).toBe(200);
  expect((await live(page, f.base, f.ruleId)).definition.conditions![0].field).toBe("task.name");
});
