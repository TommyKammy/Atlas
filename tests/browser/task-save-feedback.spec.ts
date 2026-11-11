import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const fixtures = new WeakMap<Page, { projectId: number; other: BrowserContext; attachmentIds: number[] }>();

test.afterEach(async ({ page }, info) => {
  info.setTimeout(20_000);
  const f = fixtures.get(page);
  if (!f) return;
  await f.other.close();
  // Delete real upload files through their own API before removing this fixture.
  for (const id of f.attachmentIds) {
    const response = await page.request.delete(`/api/attachments/${id}`);
    if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
  }
  const response = await page.request.delete(`/api/projects/${f.projectId}`);
  if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
});

async function fixture(page: Page, other: BrowserContext, role: "editor" | "viewer" = "editor") {
  const credentials = { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" };
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  const response = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `EV06 save feedback ${test.info().testId}` } });
  expect(response.status()).toBe(201);
  const { id: projectId } = await response.json() as { id: number };
  fixtures.set(page, { projectId, other, attachmentIds: [] });
  expect((await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: 2, role } })).status()).toBe(201);
  expect((await other.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } })).status()).toBe(200);
  const created = await page.request.post("/api/tasks", { data: { project_id: projectId, name: "Original title" } });
  expect(created.status()).toBe(201);
  const { id: taskId } = await created.json() as { id: number };
  expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { progress: 10 } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}?view=list&task=${taskId}`);
  await expect(page.locator("[data-task-pane]")).toBeVisible();
  await expect(page.locator('[data-task-draft-field="name"]')).toHaveAttribute("data-task-draft-ready", "true");
  return { projectId, taskId };
}

async function readTask(page: Page, projectId: number, taskId: number) {
  const response = await page.request.get(`/api/projects/${projectId}/export?format=json`);
  expect(response.status()).toBe(200);
  const data = await response.json() as { tasks: { id: number; name: string; progress: number; description: string; description_doc: unknown }[] };
  return data.tasks.find((item) => Number(item.id) === taskId)!;
}

function taskResponse(page: Page, taskId: number, status?: number) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === `/api/tasks/${taskId}` && response.request().method() === "PATCH" && (status === undefined || response.status() === status));
}

/** Hold just the selected request, making the saving state observable without sleeps. */
async function failOnce(page: Page, taskId: number, field: string, status = 503) {
  let release!: () => void;
  let arrive!: () => void;
  let matched = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { arrive = resolve; });
  await page.route(`**/api/tasks/${taskId}`, async (route) => {
    const request = route.request();
    if (!matched && request.method() === "PATCH" && Object.hasOwn(request.postDataJSON() as object, field)) {
      matched = true;
      arrive();
      await gate;
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: "EV06 injected save failure" }) });
      return;
    }
    await route.continue();
  });
  return { arrived, release, finish: async () => { release(); await page.unrouteAll({ behavior: "wait" }); } };
}

for (const field of ["name", "progress"] as const) {
  test(`EV06 ${field} save failure retains the draft and retries successfully without a page error`, async ({ page, browser }) => {
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const f = await fixture(page, other);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const pane = page.locator("[data-task-pane]");
    const input = pane.locator(`[data-task-draft-field="${field}"]`);
    const attempted = field === "name" ? "Title retained after 503" : "45";
    const original = field === "name" ? "Original title" : "10";
    const failure = await failOnce(page, f.taskId, field);
    try {
      const response = taskResponse(page, f.taskId, 503);
      await input.fill(attempted);
      await input.blur();
      await failure.arrived;
      await expect(pane.locator('[data-task-save-status="saving"]')).toBeVisible();
      expect(String((await readTask(page, f.projectId, f.taskId))[field])).toBe(original);
      failure.release();
      await response;
      await expect(pane.locator('[data-task-save-status="failed"]')).toBeVisible();
      await expect(input).toHaveValue(attempted);
      expect(String((await readTask(page, f.projectId, f.taskId))[field])).toBe(original);
      const saved = taskResponse(page, f.taskId, 200);
      await pane.getByRole("button", { name: `${field === "name" ? "名前" : "進捗"}を再試行`, exact: true }).click();
      await saved;
      await expect(pane.locator('[data-task-save-status="saved"]')).toBeVisible();
      await expect(input).toHaveValue(attempted);
      expect(String((await readTask(page, f.projectId, f.taskId))[field])).toBe(attempted);
      expect(errors).toEqual([]);
    } finally {
      await failure.finish();
    }
  });
}

test("EV06 discarding a failed draft restores stored values without resaving it on blur", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const f = await fixture(page, other);
  const pane = page.locator("[data-task-pane]");
  const input = pane.locator('[data-task-draft-field="name"]');
  const writes: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === `/api/tasks/${f.taskId}` && response.request().method() === "PATCH") writes.push(response.status());
  });
  const failure = await failOnce(page, f.taskId, "name");
  try {
    const failed = taskResponse(page, f.taskId, 503);
    await input.fill("Discard this unsaved title");
    await input.blur();
    await failure.arrived;
    failure.release();
    await failed;
    await expect(pane.locator('[data-task-save-status="failed"]')).toBeVisible();
    await input.focus();
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === `/projects/${f.projectId}` && response.request().headers().rsc === "1");
    await pane.getByRole("button", { name: "入力を破棄して最新表示", exact: true }).click();
    await refreshed;
    await expect(input).toHaveValue("Original title");
    await expect(pane.locator('[data-task-save-status="failed"]')).toHaveCount(0);
    await input.focus();
    await input.blur();
    expect((await readTask(page, f.projectId, f.taskId)).name).toBe("Original title");
    expect(writes).toEqual([503]);
  } finally {
    await failure.finish();
  }
});

test("EV06 permission failures explain the restriction, retain input and offer no blind retry", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const f = await fixture(page, other);
  const pane = page.locator("[data-task-pane]");
  const input = pane.locator('[data-task-draft-field="name"]');
  const failure = await failOnce(page, f.taskId, "name", 403);
  try {
    const response = taskResponse(page, f.taskId, 403);
    await input.fill("Draft after permissions changed");
    await input.blur();
    await failure.arrived;
    failure.release();
    await response;
    const notice = pane.locator('[data-task-save-status="failed"]');
    await expect(notice).toContainText("編集権限がありません");
    await expect(input).toHaveValue("Draft after permissions changed");
    await expect(notice.getByRole("button", { name: "名前を再試行", exact: true })).toHaveCount(0);
    expect((await readTask(page, f.projectId, f.taskId)).name).toBe("Original title");
  } finally {
    await failure.finish();
  }
});

test("EV06 saving another field preserves the first field's unsaved failure and draft", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const f = await fixture(page, other);
  const pane = page.locator("[data-task-pane]");
  const name = pane.locator('[data-task-draft-field="name"]');
  const failure = await failOnce(page, f.taskId, "name");
  try {
    const failed = taskResponse(page, f.taskId, 503);
    await name.fill("This field is still unsaved");
    await name.blur();
    await failure.arrived;
    failure.release();
    await failed;
    await expect(pane.locator('[data-task-save-field="name"]')).toBeVisible();
    const progress = pane.locator('[data-task-draft-field="progress"]');
    const saved = taskResponse(page, f.taskId, 200);
    await progress.fill("65");
    await progress.blur();
    await saved;
    await expect(progress).toHaveValue("65");
    await expect(pane.locator('[data-task-save-status="failed"]')).toBeVisible();
    await expect(pane.locator('[data-task-save-field="name"]')).toContainText("名前は未保存です");
    await expect(name).toHaveValue("This field is still unsaved");
    const stored = await readTask(page, f.projectId, f.taskId);
    expect(stored.name).toBe("Original title");
    expect(stored.progress).toBe(65);
  } finally {
    await failure.finish();
  }
});

test("EV06 an older same-field conflict cannot replace a newer successful save", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const f = await fixture(page, other);
  const pane = page.locator("[data-task-pane]");
  const input = pane.locator('[data-task-draft-field="name"]');
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let release!: () => void;
  let arrive!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { arrive = resolve; });
  await page.route(`**/api/tasks/${f.taskId}`, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH" && request.postDataJSON().name === "Older name A") {
      arrive();
      await gate;
    }
    await route.continue();
  });
  try {
    await input.fill("Older name A");
    await input.blur();
    await arrived;
    const newer = taskResponse(page, f.taskId, 200);
    await input.fill("Newer name B");
    await input.blur();
    await newer;
    await expect(pane.locator('[data-task-save-status="saved"]')).toBeVisible();
    expect((await readTask(page, f.projectId, f.taskId)).name).toBe("Newer name B");
    const older = taskResponse(page, f.taskId, 409);
    release();
    await (await older).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(input).toHaveValue("Newer name B");
    await expect(pane.getByText("他のユーザーが先に更新しました", { exact: true })).toHaveCount(0);
    await expect(pane.getByRole("button", { name: "最新で上書きする", exact: true })).toHaveCount(0);
    await expect(pane.locator('[data-task-save-status="saved"]')).toBeVisible();
    expect((await readTask(page, f.projectId, f.taskId)).name).toBe("Newer name B");
    expect(errors).toEqual([]);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("EV06 description failure keeps the editor draft for a successful explicit save", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const f = await fixture(page, other);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pane = page.locator("[data-task-pane]");
  const description = pane.locator("[data-task-description]");
  await description.getByRole("button", { name: "このタスクの内容を入力します", exact: true }).click();
  const editor = description.getByRole("textbox", { name: "説明", exact: true });
  await editor.fill("Description retained after a save failure");
  const failure = await failOnce(page, f.taskId, "description_doc");
  try {
    const failed = taskResponse(page, f.taskId, 503);
    await description.getByRole("button", { name: "保存", exact: true }).click();
    await failure.arrived;
    failure.release();
    await failed;
    await expect(pane.locator('[data-task-save-status="failed"]')).toBeVisible();
    await expect(editor).toContainText("Description retained after a save failure");
    const before = await readTask(page, f.projectId, f.taskId);
    expect(JSON.stringify(before.description_doc ?? before.description)).not.toContain("Description retained");
    const saved = taskResponse(page, f.taskId, 200);
    await description.getByRole("button", { name: "保存", exact: true }).click();
    await saved;
    await expect(editor).toHaveCount(0);
    await expect(description).toContainText("Description retained after a save failure");
    const stored = await readTask(page, f.projectId, f.taskId);
    expect(JSON.stringify(stored.description_doc ?? stored.description)).toContain("Description retained after a save failure");
    expect(errors).toEqual([]);
  } finally {
    await failure.finish();
  }
});

test("EV06 edits typed during description saving remain as a draft until the next save", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const f = await fixture(page, other);
  const pane = page.locator("[data-task-pane]");
  const description = pane.locator("[data-task-description]");
  await description.getByRole("button", { name: "このタスクの内容を入力します", exact: true }).click();
  const editor = description.getByRole("textbox", { name: "説明", exact: true });
  await editor.fill("Description A submitted");
  let release!: () => void;
  let arrive!: () => void;
  let held = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { arrive = resolve; });
  await page.route(`**/api/tasks/${f.taskId}`, async (route) => {
    const request = route.request();
    if (!held && request.method() === "PATCH" && Object.hasOwn(request.postDataJSON() as object, "description_doc")) {
      held = true;
      arrive();
      await gate;
    }
    await route.continue();
  });
  try {
    const first = taskResponse(page, f.taskId, 200);
    await description.getByRole("button", { name: "保存", exact: true }).click();
    await arrived;
    await expect(pane.locator('[data-task-save-status="saving"]')).toBeVisible();
    await editor.fill("Description B typed while A was saving");
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === `/projects/${f.projectId}` && response.request().headers().rsc === "1");
    release();
    await first;
    await (await refreshed).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("Description B typed while A was saving");
    const a = await readTask(page, f.projectId, f.taskId);
    expect(JSON.stringify(a.description_doc ?? a.description)).toContain("Description A submitted");
    expect(JSON.stringify(a.description_doc ?? a.description)).not.toContain("Description B typed");
    const second = taskResponse(page, f.taskId);
    await description.getByRole("button", { name: "保存", exact: true }).click();
    expect((await second).status()).toBe(200);
    await expect(editor).toHaveCount(0);
    await expect(description).toContainText("Description B typed while A was saving");
    const b = await readTask(page, f.projectId, f.taskId);
    expect(JSON.stringify(b.description_doc ?? b.description)).toContain("Description B typed while A was saving");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("EV06 viewers cannot edit core fields, description, subtasks or existing attachments but can navigate", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const f = await fixture(page, other, "viewer");
  const child = await page.request.post("/api/tasks", { data: { project_id: f.projectId, parent_task_id: f.taskId, name: "Viewer can open this child" } });
  expect(child.status()).toBe(201);
  const { id: childId } = await child.json() as { id: number };
  const attachment = await page.request.post("/api/attachments", { multipart: {
    task_id: String(f.taskId), file: { name: "ev06-viewer.txt", mimeType: "text/plain", buffer: Buffer.from("EV06 viewer fixture") },
  } });
  expect(attachment.status()).toBe(201);
  const { id: attachmentId } = await attachment.json() as { id: number };
  fixtures.get(page)!.attachmentIds.push(attachmentId);
  const viewer = await other.newPage();
  await viewer.goto(`/projects/${f.projectId}?view=list&task=${f.taskId}`);
  const pane = viewer.locator("[data-task-pane]");
  await expect(pane.locator("[data-task-readonly]")).toBeVisible();
  await expect(pane.getByRole("textbox", { name: "タスク名", exact: true })).toHaveJSProperty("readOnly", true);
  await expect(pane.getByRole("spinbutton", { name: "進捗", exact: true })).toBeDisabled();
  const completionButtons = pane.getByRole("button", { name: "完了にする", exact: true });
  await expect(completionButtons).toHaveCount(2); // parent header and the fixture child
  for (const button of await completionButtons.all()) await expect(button).toBeDisabled();
  const fields = pane.locator("[data-task-fields]");
  await expect(fields).toHaveAttribute("disabled", "");
  await expect(fields).toHaveJSProperty("disabled", true);
  const fieldControls = fields.locator("input, button, select, textarea");
  expect(await fieldControls.count()).toBeGreaterThan(0);
  for (const control of await fieldControls.all()) await expect(control).toBeDisabled();
  await expect(pane.locator('[data-task-description] [contenteditable="true"]')).toHaveCount(0);
  await expect(pane.locator("[data-task-description]").getByRole("button")).toHaveCount(0);
  for (const button of await pane.locator("[data-task-subtasks]").getByRole("button", { name: "サブタスクを追加", exact: true }).all()) await expect(button).toBeDisabled();
  await expect(pane.locator('[data-task-subtasks] [title="サブタスクを削除"]')).toBeDisabled();
  await expect(pane.locator('[data-task-attachments] input[type="file"]')).toHaveCount(0);
  await expect(pane.locator("[data-task-attachments]").getByRole("button", { name: "ev06-viewer.txt を削除", exact: true })).toHaveCount(0);
  await expect(pane.locator(`a[href="/api/attachments/${attachmentId}"]`)).toBeVisible();
  await pane.locator("[data-task-subtasks]").getByRole("link", { name: "Viewer can open this child", exact: true }).click();
  await expect(viewer).toHaveURL(new RegExp(`task=${childId}(?:&|$)`));
  await expect(viewer.locator('[data-task-draft-field="name"]')).toHaveValue("Viewer can open this child");
  await viewer.locator("[data-task-pane]").getByRole("link", { name: "詳細を閉じる", exact: true }).click();
  await expect(viewer.locator("[data-task-pane]")).toHaveCount(0);
});
