import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

const credentials = {
  email: process.env.E2E_EMAIL ?? "admin@example.com",
  password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
};
const fixtures = new WeakMap<Page, number>();

type Section = { id: number; name: string };
type SavedTask = { id: number; name: string; section_id: number | null };

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});

test.afterEach(async ({ page }, info) => {
  info.setTimeout(20_000);
  const projectId = fixtures.get(page);
  if (projectId === undefined) return;
  await page.unrouteAll({ behavior: "wait" });
  if (!page.isClosed()) await page.goto("about:blank");
  const response = await page.request.delete(`/api/projects/${projectId}`);
  if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
});

async function sections(page: Page, projectId: number): Promise<Section[]> {
  const response = await page.request.get(`/api/lookup?project_id=${projectId}`);
  expect(response.status()).toBe(200);
  return await response.json() as Section[];
}

async function tasks(page: Page, projectId: number): Promise<SavedTask[]> {
  const response = await page.request.get(`/api/projects/${projectId}/export?format=json`);
  expect(response.status()).toBe(200);
  return (await response.json() as { tasks: SavedTask[] }).tasks;
}

async function fixture(page: Page) {
  const response = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Inline section insert ${test.info().testId} ${Date.now()}` },
  });
  expect(response.status()).toBe(201);
  const { id: projectId } = await response.json() as { id: number };
  fixtures.set(page, projectId);
  for (const section of await sections(page, projectId)) {
    expect((await page.request.delete(`/api/sections/${section.id}`)).status()).toBe(200);
  }
  const created: Section[] = [];
  for (const name of ["計画", "進行中", "完了"]) {
    const section = await page.request.post("/api/sections", { data: { project_id: projectId, name } });
    expect(section.status()).toBe(201);
    created.push(await section.json() as Section);
  }
  return { projectId, sections: created };
}

async function openList(page: Page, projectId: number) {
  await page.goto(`/projects/${projectId}?view=list`);
  await expect(page.locator("[data-list-view]")).toBeVisible();
  // Hydration probe that never performs a write.
  await expect(async () => {
    if (!await page.getByRole("menu", { name: "追加の種類" }).isVisible()) {
      await page.getByRole("button", { name: "追加オプション" }).first().click();
    }
    await expect(page.getByRole("menu", { name: "追加の種類" })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.keyboard.press("Escape");
}

function sectionBlock(page: Page, id: number): Locator {
  return page.locator(`[data-list-section-block="${id}"]`);
}

function draft(page: Page): Locator {
  return page.locator('[data-section-draft="true"]');
}

function draftInput(page: Page): Locator {
  return page.locator("[data-add-section-input]");
}

function newTaskName(root: Locator): Locator {
  return root.getByRole("textbox", { name: "新しいタスク名", exact: true });
}

function sectionResponse(page: Page, status = 201): Promise<Response> {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/sections" &&
    response.request().method() === "POST" && response.status() === status);
}

test("end composer creates a section in place, focuses its task row and keeps entering tasks", async ({ page }) => {
  const f = await fixture(page);
  await openList(page, f.projectId);
  await page.getByRole("button", { name: "＋ セクションを追加", exact: true }).click();
  const input = draftInput(page);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("placeholder", "新しいセクション");
  await expect(input).toHaveValue("");
  // No extra form controls: only the heading-shaped draft with its usual
  // collapse, add, menu and drag affordances.
  await expect(draft(page).getByRole("button", { name: /^追加|キャンセル$/ })).toHaveCount(0);
  await expect(draft(page).locator("input")).toHaveCount(1);
  await expect(draft(page).getByRole("button", { name: "折りたたむ", exact: true })).toBeVisible();
  await expect(draft(page).getByRole("button", { name: "このセクションにタスクを追加", exact: true })).toBeVisible();
  await expect(draft(page).getByRole("button", { name: "セクションのその他のアクション", exact: true })).toBeVisible();
  await expect(draft(page).locator("[data-section-draft-drag]")).toBeVisible();
  await expect(draft(page).getByText("0", { exact: true })).toBeVisible();

  await input.fill("新しいフェーズ");
  const created = sectionResponse(page);
  await input.press("Enter");
  const response = await created;
  expect(response.request().postDataJSON()).toEqual({ project_id: f.projectId, name: "新しいフェーズ" });
  const { id } = await response.json() as Section;

  const block = sectionBlock(page, id);
  await expect(block).toContainText("新しいフェーズ");
  await expect(page.locator("[data-list-section-block]").last()).toHaveAttribute("data-list-section-block", String(id));
  await expect(draft(page)).toHaveCount(0);

  const taskInput = newTaskName(block);
  await expect(taskInput).toBeVisible();
  await expect(taskInput).toBeFocused();
  await taskInput.fill("最初のタスク");
  const taskCreated = page.waitForResponse((res) =>
    new URL(res.url()).pathname === "/api/tasks" &&
    res.request().method() === "POST" && res.status() === 201);
  await taskInput.press("Enter");
  await taskCreated;
  await expect.poll(async () => (await tasks(page, f.projectId)).find((task) => task.name === "最初のタスク")?.section_id).toBe(id);
  await expect(block).toContainText("最初のタスク");

  // The next row is already focused; an empty row is discarded with Escape.
  const nextInput = newTaskName(block);
  await expect(nextInput).toBeVisible();
  await expect(nextInput).toBeFocused();
  await expect(nextInput).toHaveValue("");
  // The post-save server refresh must not interrupt the next composer.
  await nextInput.fill("入力途中のタスク");
  await page.waitForTimeout(500);
  await expect(nextInput).toBeFocused();
  await expect(nextInput).toHaveValue("入力途中のタスク");
  await nextInput.press("Escape");
  await expect(nextInput).toHaveCount(0);

  await page.reload();
  const reloaded = sectionBlock(page, id);
  await expect(reloaded).toContainText("新しいフェーズ");
  await expect(reloaded).toContainText("最初のタスク");
  expect((await sections(page, f.projectId)).at(-1)?.id).toBe(id);
});

test("section menu inserts above and below with keyboard access and survives reload", async ({ page }) => {
  const f = await fixture(page);
  await openList(page, f.projectId);
  const second = f.sections[1];
  const trigger = page.locator(`[data-section-menu-button="${second.id}"]`);
  await page.locator(`[data-list-section-header="s:${second.id}"]`).hover();
  await trigger.click();
  const menu = page.getByRole("menu", { name: "セクションのその他のアクション" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await menu.getByRole("menuitem").first().press("ArrowDown");
  const addAbove = menu.getByRole("menuitem", { name: "上にセクションを追加", exact: true });
  await expect(addAbove).toBeFocused();
  await addAbove.press("Enter");

  let input = draftInput(page);
  await expect(input).toBeFocused();
  await input.fill("上に挿入");
  let created = sectionResponse(page);
  await input.press("Enter");
  const aboveResponse = await created;
  let body = aboveResponse.request().postDataJSON();
  expect(body).toEqual({ project_id: f.projectId, name: "上に挿入", before_section_id: second.id });

  // The newly focused empty task composer is a normal transient draft.
  const aboveId = (await aboveResponse.json() as Section).id;
  const aboveComposer = newTaskName(sectionBlock(page, aboveId));
  await expect(aboveComposer).toBeFocused();
  await aboveComposer.press("Escape");
  await expect(aboveComposer).toHaveCount(0);
  await page.locator(`[data-list-section-header="s:${second.id}"]`).hover();
  await trigger.click();
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "下にセクションを追加", exact: true }).click();
  input = draftInput(page);
  await expect(input).toBeFocused();
  await input.fill("下に挿入");
  created = sectionResponse(page);
  await input.press("Enter");
  body = (await created).request().postDataJSON();
  expect(body).toEqual({ project_id: f.projectId, name: "下に挿入", after_section_id: second.id });

  await expect.poll(async () => (await sections(page, f.projectId)).map((section) => section.name))
    .toEqual(["計画", "上に挿入", "進行中", "下に挿入", "完了"]);
  await page.reload();
  const names = await page.locator("[data-section-name]").allTextContents();
  expect(names).toEqual(["計画", "上に挿入", "進行中", "下に挿入", "完了"]);
  expect((await sections(page, f.projectId)).map((section) => section.name))
    .toEqual(["計画", "上に挿入", "進行中", "下に挿入", "完了"]);
});

test("blur saves a named draft without moving focus into the task row", async ({ page }) => {
  const f = await fixture(page);
  await openList(page, f.projectId);
  await page.getByRole("button", { name: "＋ セクションを追加", exact: true }).click();
  const input = draftInput(page);
  await input.fill("ぼかしで保存");
  const created = sectionResponse(page);
  await page.locator("[data-list-summary]").click();
  const { id } = await (await created).json() as Section;
  await expect(sectionBlock(page, id)).toContainText("ぼかしで保存");
  await expect(draft(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "新しいタスク名", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(sectionBlock(page, id)).toContainText("ぼかしで保存");
});

test("empty Escape and empty blur discard the draft without a request", async ({ page }) => {
  const f = await fixture(page);
  await openList(page, f.projectId);
  const writes: unknown[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/sections" && request.method() === "POST") {
      writes.push(request.postDataJSON());
    }
  });
  const before = await sections(page, f.projectId);

  const trigger = page.getByRole("button", { name: "＋ セクションを追加", exact: true });
  await trigger.click();
  await expect(draftInput(page)).toBeFocused();
  await draftInput(page).press("Escape");
  await expect(draft(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(draftInput(page)).toBeFocused();
  await page.locator("[data-list-summary]").click();
  await expect(draft(page)).toHaveCount(0);

  await expect.poll(() => writes.length).toBe(0);
  expect(await sections(page, f.projectId)).toEqual(before);
  await expect(page.locator("[data-add-section-input]")).toHaveCount(0);
});

test("IME conversion confirmation keeps the draft until the following Enter", async ({ page }) => {
  const f = await fixture(page);
  await openList(page, f.projectId);
  await page.getByRole("button", { name: "＋ セクションを追加", exact: true }).click();
  const input = draftInput(page);
  await input.fill("日本語の工程");
  const writes: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/sections" && response.request().method() === "POST") {
      writes.push(response.status());
    }
  });
  await input.dispatchEvent("compositionstart", { data: "日本語" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, isComposing: true, bubbles: true });
  await input.dispatchEvent("compositionend", { data: "日本語" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: false, bubbles: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("日本語の工程");
  expect(writes).toEqual([]);

  const created = sectionResponse(page);
  await input.press("Enter");
  await created;
  expect(writes).toEqual([201]);
  await expect.poll(async () => (await sections(page, f.projectId)).filter((section) => section.name === "日本語の工程")).toHaveLength(1);
});

test("toolbar section adds below the last touched task's section", async ({ page }) => {
  const f = await fixture(page);
  const task = await page.request.post("/api/tasks", {
    data: { project_id: f.projectId, section_id: f.sections[1].id, name: "操作するタスク" },
  });
  expect(task.status()).toBe(201);
  const { id: taskId } = await task.json() as { id: number };
  await openList(page, f.projectId);

  await page.locator(`[data-list-row="${taskId}"]`).focus();
  await page.getByRole("button", { name: "追加オプション" }).first().click();
  await page.getByRole("menuitem", { name: "セクション", exact: true }).click();

  const input = draftInput(page);
  await expect(input).toBeFocused();
  await input.fill("タスクの下");
  const created = sectionResponse(page);
  await input.press("Enter");
  const body = (await created).request().postDataJSON();
  expect(body).toEqual({ project_id: f.projectId, name: "タスクの下", after_section_id: f.sections[1].id });
  await expect.poll(async () => (await sections(page, f.projectId)).map((section) => section.name))
    .toEqual(["計画", "進行中", "タスクの下", "完了"]);
  await expect(sectionBlock(page, f.sections[1].id)).toBeVisible();
});

test("toolbar section falls back to the end when nothing was touched", async ({ page }) => {
  const f = await fixture(page);
  await openList(page, f.projectId);
  await page.reload();
  await expect(page.locator("[data-list-view]")).toBeVisible();
  await page.getByRole("button", { name: "追加オプション" }).first().click();
  await page.getByRole("menuitem", { name: "セクション", exact: true }).click();
  const input = draftInput(page);
  await expect(input).toBeFocused();
  await input.fill("末尾の工程");
  const created = sectionResponse(page);
  await input.press("Enter");
  const body = (await created).request().postDataJSON();
  expect(body).toEqual({ project_id: f.projectId, name: "末尾の工程" });
  await expect.poll(async () => (await sections(page, f.projectId)).at(-1)?.name).toBe("末尾の工程");
});

test("failed save keeps the named draft visible and retries from the same input", async ({ page }) => {
  const f = await fixture(page);
  await openList(page, f.projectId);
  let attempts = 0;
  await page.route("**/api/sections", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "injected" }) });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "＋ セクションを追加", exact: true }).click();
  const input = draftInput(page);
  await input.fill("再試行する工程");
  const failed = sectionResponse(page, 500);
  await input.press("Enter");
  await failed;
  const alert = draft(page).getByRole("alert");
  await expect(alert).toHaveText("セクションの追加に失敗しました。もう一度お試しください。");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("再試行する工程");
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  expect((await sections(page, f.projectId)).map((section) => section.name))
    .toEqual(["計画", "進行中", "完了"]);

  const retried = sectionResponse(page);
  await input.press("Enter");
  const { id } = await (await retried).json() as Section;
  await expect(sectionBlock(page, id)).toContainText("再試行する工程");
  await expect(draft(page)).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("the draft heading opens exactly where the add button was and its text lines up with section names", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const textStart = (input: Locator) => input.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  });

  // List: the add row has the heading geometry, so nothing jumps on click.
  await openList(page, f.projectId);
  const trigger = page.getByRole("button", { name: "＋ セクションを追加", exact: true });
  await trigger.scrollIntoViewIfNeeded();
  const row = (await page.locator("[data-list-section-add-row]").boundingBox())!;
  const nameX = (await page.locator(`[data-section-name="${f.sections[0].id}"]`).boundingBox())!.x;
  await trigger.click();
  const input = page.getByRole("textbox", { name: "セクション名" });
  await expect(input).toBeFocused();
  const draftRow = (await page.locator("[data-list-section-header]").filter({ has: input }).boundingBox())!;
  expect(Math.round(draftRow.y), "list draft row replaces the add row").toBe(Math.round(row.y));
  expect(Math.round(draftRow.height)).toBe(Math.round(row.height));
  expect(Math.round(await textStart(input)), "list draft text starts at the section name column").toBe(Math.round(nameX));
  await page.keyboard.press("Escape");

  // Board: the typed name starts where column titles start.
  await page.goto(`/projects/${f.projectId}?view=board`);
  const boardTrigger = page.getByRole("button", { name: "＋ セクションを追加", exact: true });
  await boardTrigger.scrollIntoViewIfNeeded();
  const buttonBox = (await boardTrigger.boundingBox())!;
  await boardTrigger.click();
  const boardInput = page.getByRole("textbox", { name: "セクション名" });
  await expect(boardInput).toBeFocused();
  const draftColumn = (await page.locator("[data-board-section-draft]").boundingBox())!;
  const realColumn = page.locator("[data-board-column]").filter({ has: page.locator("[data-board-column-header]") }).last();
  const offset = await realColumn.evaluate((column) =>
    column.querySelector("[data-board-column-header]")!.getBoundingClientRect().x - column.getBoundingClientRect().x);
  expect(Math.round(await textStart(boardInput) - draftColumn.x), "board draft text offset").toBe(Math.round(offset));
  expect(Math.round((await boardInput.boundingBox())!.y), "board draft opens at the button row").toBe(Math.round(buttonBox.y));
  await page.keyboard.press("Escape");
});
