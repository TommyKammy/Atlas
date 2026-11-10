import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const login = await page.request.post("/api/auth/login", { data: {
    email: process.env.E2E_EMAIL ?? "admin@example.com",
    password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
  } });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post("/api/projects", { data: {
    workspace_id: 1, name: `AR10 AR14 ${test.info().testId} ${Date.now()}`,
  } });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  const rules: number[] = [];
  for (const [name, event, enabled] of [
    ["Result A", "task.manual_rule", true], ["Result B", "task.manual_rule", true],
    ["Disabled", "task.manual_rule", false], ["Automatic", "task.created", true],
  ] as const) {
    const response = await page.request.post(`/api/projects/${projectId}/rules`, { data: {
      name, enabled, definition: { triggers: [{ event }], actions: [{ capability: "task.create", params: { name: "created" } }] },
    } });
    expect(response.status()).toBe(201);
    rules.push((await response.json() as { id: number }).id);
  }
  await page.goto(`/projects/${projectId}?view=list`);
  await page.locator("[data-project-customize]").click();
  const drawer = page.locator("[data-project-customize-drawer]");
  await drawer.getByRole("button", { name: /AIと自動化/ }).click();
  return { projectId, rules, row: (index: number) => drawer.locator(`[data-automation-rule="${rules[index]}"]`) };
}

function run(id: number, stamp: string) {
  return { id, status: "success", started_at: stamp, actions_succeeded: 1, actions_total: 1, details: [] };
}

test("AR14 reversed history responses cannot replace the selected rule's rows", async ({ page }) => {
  const f = await fixture(page);
  let release!: () => void;
  let started!: () => void;
  let settled!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  const finished = new Promise<void>((resolve) => { settled = resolve; });
  await page.route(`**/api/projects/${f.projectId}/rules/${f.rules[0]}/runs?limit=30`, async (route) => {
    started();
    await delayed;
    try { await route.fulfill({ json: { runs: [run(1, "A stale result")] } }); } catch { /* request aborted on close */ }
    settled();
  });
  await page.route(`**/api/projects/${f.projectId}/rules/${f.rules[1]}/runs?limit=30`, (route) =>
    route.fulfill({ json: { runs: [run(2, "B current result")] } }));
  await f.row(0).getByRole("button", { name: "履歴", exact: true }).click();
  await requested;
  const a = page.getByRole("dialog", { name: "Result A の実行履歴" });
  await expect(a.getByRole("status")).toContainText("読み込んでいます");
  await expect(a.getByText("実行履歴はありません。", { exact: true })).toHaveCount(0);
  await a.getByRole("button", { name: "閉じる", exact: true }).click();
  await f.row(1).getByRole("button", { name: "履歴", exact: true }).click();
  const b = page.getByRole("dialog", { name: "Result B の実行履歴" });
  await expect(b.getByText("B current result", { exact: true })).toBeVisible();
  release();
  await finished;
  await expect(b.getByText("B current result", { exact: true })).toBeVisible();
  await expect(b.getByText("A stale result", { exact: true })).toHaveCount(0);
});

test("AR14 history failure is distinct from an empty history and reopening clears the error", async ({ page }) => {
  const f = await fixture(page);
  let failed = true;
  await page.route(`**/api/projects/${f.projectId}/rules/${f.rules[0]}/runs?limit=30`, (route) =>
    route.fulfill(failed ? { status: 503, json: { error: "unavailable" } } : { json: { runs: [] } }));
  await f.row(0).getByRole("button", { name: "履歴", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Result A の実行履歴" });
  await expect(dialog.getByRole("alert")).toHaveText("実行履歴を取得できませんでした");
  await expect(dialog.getByText("実行履歴はありません。", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  failed = false;
  await f.row(0).getByRole("button", { name: "履歴", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Result A の実行履歴" });
  await expect(dialog.getByText("実行履歴はありません。", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("AR10 manual UI reports queued then success, skipped and failed without a false success", async ({ page }) => {
  const f = await fixture(page);
  await expect(f.row(2).getByRole("button", { name: "実行", exact: true })).toHaveCount(0);
  await expect(f.row(3).getByRole("button", { name: "実行", exact: true })).toHaveCount(0);
  let status = "queued";
  let submissions = 0;
  await page.route(`**/api/projects/${f.projectId}/rules/${f.rules[0]}/run`, (route) => {
    submissions += 1;
    return route.fulfill({ status: status === "queued" ? 202 : 201, json: {
      event_id: 77, status, error: status === "failed" ? "invalid task" : null,
    } });
  });
  await page.route(`**/api/projects/${f.projectId}/rules/${f.rules[0]}/runs?event_id=77`, (route) =>
    route.fulfill({ json: { execution: { event_id: 77, status: "success", error: null }, runs: [] } }));
  for (const [next, message] of [
    ["queued", "ルールの実行が成功しました。"],
    ["skipped", "ルールの実行をスキップしました。"],
    ["failed", "ルールの実行に失敗しました。invalid task"],
  ]) {
    status = next;
    await f.row(0).getByRole("button", { name: "実行", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Result A を手動実行" });
    await dialog.getByRole("textbox", { name: "対象タスクID" }).fill("123");
    await dialog.getByRole("button", { name: "実行", exact: true }).click();
    if (next === "queued") {
      await expect(dialog.getByRole("status")).toContainText("実行待ちです");
      await expect(dialog.getByRole("button", { name: "実行待ち…", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("status")).not.toContainText("成功");
    }
    await expect(dialog.getByRole("status")).toContainText(message);
    if (next !== "queued") await expect(dialog.getByRole("status")).not.toContainText("成功");
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  }
  expect(submissions).toBe(3);
});

test("AR10 a deleted queued rule stops polling and never reports an unconfirmed result as success", async ({ page }) => {
  const f = await fixture(page);
  await page.clock.install();
  let polls = 0;
  await page.route(`**/api/projects/${f.projectId}/rules/${f.rules[0]}/run`, (route) =>
    route.fulfill({ status: 202, json: { event_id: 78, status: "queued", error: null } }));
  await page.route(`**/api/projects/${f.projectId}/rules/${f.rules[0]}/runs?event_id=78`, (route) => {
    polls += 1;
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await f.row(0).getByRole("button", { name: "実行", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Result A を手動実行" });
  await dialog.getByRole("textbox", { name: "対象タスクID" }).fill("123");
  await dialog.getByRole("button", { name: "実行", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("実行待ちです");
  await page.clock.runFor(1100);
  await expect(dialog.getByRole("status")).toHaveText("実行結果の確認を終了しました。");
  await expect(dialog.getByRole("button", { name: "結果未確認", exact: true })).toBeDisabled();
  await page.clock.runFor(5000);
  expect(polls).toBe(1);
  await expect(dialog.getByRole("status")).not.toContainText("成功");
});

test("AR10 closing the result dialog does not cancel the completed run's list refresh", async ({ page }) => {
  const f = await fixture(page);
  const original = await page.request.get(`/api/projects/${f.projectId}/rules`);
  expect(original.ok()).toBeTruthy();
  const data = await original.json() as { rules: { id: number; last_run_at: string | null }[] };
  await expect(f.row(0)).not.toContainText("実行履歴あり");
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route(`**/api/projects/${f.projectId}/rules`, async (route) => {
    started();
    await pending;
    await route.fulfill({ json: { rules: data.rules.map((rule) => rule.id === f.rules[0]
      ? { ...rule, last_run_at: "2026-11-10 00:00:00+00" } : rule) } });
  });
  await page.route(`**/api/projects/${f.projectId}/rules/${f.rules[0]}/run`, (route) =>
    route.fulfill({ status: 201, json: { event_id: 79, status: "success", error: null } }));
  await f.row(0).getByRole("button", { name: "実行", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Result A を手動実行" });
  await dialog.getByRole("textbox", { name: "対象タスクID" }).fill("123");
  await dialog.getByRole("button", { name: "実行", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("ルールの実行が成功しました。");
  await requested;
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  release();
  await expect(f.row(0)).toContainText("実行履歴あり");
});
