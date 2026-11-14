import { expect, test, type Page } from "@playwright/test";

const fixtures = new WeakMap<Page, number>();
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: {
    email: process.env.E2E_EMAIL ?? "admin@example.com",
    password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
  } })).status()).toBe(200);
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await page.goto("about:blank");
  const id = fixtures.get(page);
  if (id) expect((await page.request.delete(`/api/projects/${id}`)).ok()).toBeTruthy();
});
async function fixture(page: Page) {
  const response = await page.request.post("/api/projects", { data: {
    workspace_id: 1, name: `Refactoring regression ${Date.now()} ${test.info().testId}`,
  } });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: number };
  fixtures.set(page, id);
  const sections = await (await page.request.get(`/api/lookup?project_id=${id}`)).json() as { id: number }[];
  return { projectId: id, sectionId: sections[0].id };
}
async function createTask(page: Page, projectId: number, fields: Record<string, unknown>) {
  const response = await page.request.post("/api/tasks", { data: { project_id: projectId, name: "preserved task", ...fields } });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: number };
  // Creation intentionally accepts only core fields; set optional fields through PATCH.
  const patch = Object.fromEntries(Object.entries(fields).filter(([key]) => key === "status" || key === "description"));
  if (Object.keys(patch).length) expect((await page.request.patch(`/api/tasks/${id}`, { data: patch })).status()).toBe(200);
  return id;
}
function taskResponse(page: Page, taskId: number) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === `/api/tasks/${taskId}` && response.request().method() === "PATCH");
}
for (const group of ["assignee", "status"] as const) {
  for (const conflict of [false, true]) {
    test(`board ${group} moves retain optimistic locking and ${conflict ? "recover from conflict" : "refresh after save"}`, async ({ page }) => {
      const { projectId, sectionId } = await fixture(page);
      const taskId = await createTask(page, projectId, { section_id: sectionId, status: "inbox" });
      await createTask(page, projectId, { section_id: sectionId, name: "destination", assignee_id: 1, status: "doing" });
      await page.goto(`/projects/${projectId}?view=board&group=${group}&auto_refresh=0`);
      const card = page.locator(`[data-board-card="${taskId}"]`);
      const key = group === "assignee" ? "u1" : "doing";
      const destination = page.locator(`[data-board-column="${key}"]`);
      await expect(card).toBeVisible();
      // Wait for hydration using the drawer's idempotent open action.
      await expect(async () => {
        await page.locator("[data-project-customize]").click();
        await expect(page.locator("[data-project-customize-drawer]")).toBeVisible({ timeout: 500 });
      }).toPass();
      await page.locator("[data-project-customize-drawer]").getByRole("button", { name: "閉じる", exact: true }).click();
      if (conflict) await page.route(`**/api/tasks/${taskId}`, (route) => route.fulfill({ status: 409, json: { error: "conflict" } }));
      const pending = taskResponse(page, taskId);
      await card.dragTo(destination, { sourcePosition: { x: 12, y: 40 }, targetPosition: { x: 100, y: 40 } });
      const response = await pending;
      const body = response.request().postDataJSON() as Record<string, unknown>;
      expect(body.expected_updated_at).toEqual(expect.any(String));
      expect(body[group === "assignee" ? "assignee_id" : "status"]).toBe(group === "assignee" ? 1 : "doing");
      expect(response.status()).toBe(conflict ? 409 : 200);
      if (conflict) {
        await expect(page.getByText("他のユーザーが先に更新しました。最新を表示します。", { exact: true })).toBeVisible();
        await expect(destination.locator(`[data-board-card="${taskId}"]`)).toHaveCount(0);
      } else {
        await expect(destination.locator(`[data-board-card="${taskId}"]`)).toBeVisible();
        await page.reload();
        await expect(destination.locator(`[data-board-card="${taskId}"]`)).toBeVisible();
      }
    });
  }
}
for (const edge of ["start", "end"] as const) {
  test(`calendar ${edge} resize preserves the opposite endpoint`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { projectId, sectionId } = await fixture(page);
    const taskId = await createTask(page, projectId, { section_id: sectionId, start_on: "2026-11-10", due_on: "2026-11-12" });
    await page.goto(`/projects/${projectId}?view=calendar&month=2026-11&show_multi=true&show_weekends=true`);
    const bar = page.locator(`[data-calendar-multiday="${taskId}"]`).first();
    await expect(bar).toBeVisible();
    const handle = bar.locator(`[data-calendar-resize="${edge}"]`);
    const box = (await handle.boundingBox())!;
    const width = await page.locator("[data-calendar-day]").evaluateAll((cells) => Math.max(...cells.map((cell) => cell.getBoundingClientRect().width)));
    // Focus/click a control first so the pointer gesture follows hydration.
    await page.locator("[data-project-customize]").click();
    await expect(page.locator("[data-project-customize-drawer]")).toBeVisible();
    await page.locator("[data-project-customize-drawer]").getByRole("button", { name: "閉じる", exact: true }).click();
    const pending = taskResponse(page, taskId);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + width, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const response = await pending;
    expect(response.status()).toBe(200);
    const body = response.request().postDataJSON() as Record<string, unknown>;
    expect(body[edge === "start" ? "start_on" : "due_on"]).toBe(edge === "start" ? "2026-11-11" : "2026-11-13");
    const opposite = edge === "start" ? "due_on" : "start_on";
    if (opposite in body) expect(body[opposite]).toBe(edge === "start" ? "2026-11-12" : "2026-11-10");
    expect(body.expected_updated_at).toEqual(expect.any(String));
    const current = await page.request.patch(`/api/tasks/${taskId}`, { data: { name: "unused", expected_updated_at: "2000-01-01T00:00:00Z" } });
    expect(current.status()).toBe(409);
    const snapshot = (await current.json()).current;
    expect(snapshot.start_on).toBe(edge === "start" ? "2026-11-11" : "2026-11-10");
    expect(snapshot.due_on).toBe(edge === "end" ? "2026-11-13" : "2026-11-12");
  });
}
test("task HTTP adapter preserves validation, conflict snapshots and delete responses", async ({ page }) => {
  const { projectId, sectionId } = await fixture(page);
  const taskId = await createTask(page, projectId, { section_id: sectionId, description: "keep this content" });
  const invalid = await page.request.patch(`/api/tasks/${taskId}`, { data: "{", headers: { "Content-Type": "application/json" } });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toEqual({ error: "invalid json" });
  const stale = await page.request.patch(`/api/tasks/${taskId}`, { data: { name: "must not overwrite", expected_updated_at: "2000-01-01T00:00:00Z" } });
  expect(stale.status()).toBe(409);
  const snapshot = await stale.json();
  expect(snapshot).toMatchObject({ error: "conflict", current: { name: "preserved task", description: "keep this content" } });
  expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { name: "new name", expected_updated_at: snapshot.updated_at } })).status()).toBe(200);
  const deleted = await page.request.delete(`/api/tasks/${taskId}`);
  expect(deleted.status()).toBe(200);
  expect(await deleted.json()).toEqual({ deleted: taskId });
});
test("customize fields and templates remain saved across panel navigation and reload", async ({ page }) => {
  const { projectId } = await fixture(page);
  await page.goto(`/projects/${projectId}?view=list`);
  await expect(async () => {
    await page.locator("[data-project-customize]").click();
    await expect(page.locator("[data-project-customize-drawer]")).toBeVisible({ timeout: 500 });
  }).toPass();
  const drawer = page.locator("[data-project-customize-drawer]");
  await drawer.getByRole("button", { name: "フィールド", exact: false }).first().click();
  await page.locator("[data-customize-add-field]").click();
  await page.locator("[data-customize-field-name]").fill("Preserved custom field");
  await page.locator("[data-customize-field-save]").click();
  await expect(drawer.getByText("Preserved custom field", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "戻る", exact: true }).click();
  await drawer.getByRole("button", { name: /タスクタイプとテンプレート/ }).click();
  await page.locator("[data-customize-add-template]").click();
  await page.locator("[data-customize-template-name]").fill("Preserved template");
  await page.locator("[data-customize-template-title]").fill("Task from preserved template");
  await page.locator("[data-customize-template-save]").click();
  await expect(drawer.getByText("Preserved template", { exact: true })).toBeVisible();
  const fields = await (await page.request.get(`/api/custom-fields?project_id=${projectId}`)).json();
  expect(fields.some((field: { name: string }) => field.name === "Preserved custom field")).toBe(true);
  const templates = await (await page.request.get(`/api/task-templates?project_id=${projectId}`)).json();
  const template = templates.find((entry: { name: string }) => entry.name === "Preserved template");
  expect(template.title_template).toBe("Task from preserved template");
  await page.locator(`[data-customize-template-use="${template.id}"]`).click();
  await expect(page.getByText("「Preserved template」からタスクを作成しました", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Task from preserved template", { exact: true }).first()).toBeVisible();
});

for (const multi of [false, true]) {
  test(`calendar ${multi ? "range" : "single day"} touch cancellation writes nothing and the next gesture moves one day`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { projectId, sectionId } = await fixture(page);
    const taskId = await createTask(page, projectId, {
      section_id: sectionId, due_on: multi ? "2026-11-12" : "2026-11-10",
      ...(multi ? { start_on: "2026-11-10" } : {}),
    });
    await page.goto(`/projects/${projectId}?view=calendar&month=2026-11`);
    await expect(async () => {
      await page.locator("[data-project-customize]").click();
      await expect(page.locator("[data-project-customize-drawer]")).toBeVisible({ timeout: 500 });
    }).toPass();
    await page.locator("[data-project-customize-drawer]").getByRole("button", { name: "閉じる", exact: true }).click();
    const bar = page.locator(`[data-calendar-${multi ? "multiday" : "single"}="${taskId}"]`).first();
    await bar.scrollIntoViewIfNeeded();
    const box = (await bar.boundingBox())!;
    const width = await page.locator("[data-calendar-day]").evaluateAll((cells) => Math.max(...cells.map((cell) => cell.getBoundingClientRect().width)));
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const writes: unknown[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === `/api/tasks/${taskId}` && request.method() === "PATCH") writes.push(request.postDataJSON());
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + width, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(writes).toHaveLength(0);
    const pending = taskResponse(page, taskId);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + width, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const response = await pending;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ due_on: multi ? "2026-11-13" : "2026-11-11" });
    expect(writes).toHaveLength(1);
    await cdp.detach();
  });
}
