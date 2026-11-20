import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

const credentials = {
  email: process.env.E2E_EMAIL ?? "admin@example.com",
  password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
};
const fixtures = new WeakMap<Page, number>();

type Section = { id: number; name: string };

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});

test.afterEach(async ({ page }, info) => {
  info.setTimeout(20_000);
  const projectId = fixtures.get(page);
  if (projectId === undefined) return;
  await page.unrouteAll({ behavior: "wait" });
  // Only this test's project is removed, after disconnecting its realtime page.
  if (!page.isClosed()) await page.goto("about:blank");
  const response = await page.request.delete(`/api/projects/${projectId}`);
  if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
});

async function sections(page: Page, projectId: number): Promise<Section[]> {
  const response = await page.request.get(`/api/lookup?project_id=${projectId}`);
  expect(response.status()).toBe(200);
  return await response.json() as Section[];
}

async function fixture(page: Page, empty = false) {
  const response = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Inline timeline section ${test.info().testId} ${Date.now()}` },
  });
  expect(response.status()).toBe(201);
  const { id: projectId } = await response.json() as { id: number };
  fixtures.set(page, projectId);
  const initial = await sections(page, projectId);
  if (empty) {
    for (const section of initial) {
      expect((await page.request.delete(`/api/sections/${section.id}`)).status()).toBe(200);
    }
  }
  return { projectId, initial: empty ? [] : initial };
}

async function openTimeline(page: Page, projectId: number) {
  await page.goto(`/projects/${projectId}?view=timeline&zoom=2`);
  await expect(page.locator("[data-timeline-zoom]")).toBeVisible();
}

function editor(page: Page) {
  const wrapper = page.locator("[data-timeline-section-add]");
  return {
    wrapper,
    draft: page.locator("[data-timeline-section-draft]"),
    start: wrapper.getByRole("button", { name: "＋ セクションを追加", exact: true }),
    input: wrapper.locator("[data-add-section-input]"),
  };
}

async function startSection(page: Page) {
  const e = editor(page);
  // The server-rendered action can appear before its client handler hydrates.
  await expect(async () => {
    if (await e.start.isVisible()) await e.start.click();
    await expect(e.input).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await expect(e.input).toBeFocused();
  return e;
}

function sectionResponse(page: Page, status = 201): Promise<Response> {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/sections" &&
    response.request().method() === "POST" && response.status() === status);
}

function sectionWrites(page: Page) {
  const writes: { project_id: number; name: string }[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/sections" && request.method() === "POST") {
      writes.push(request.postDataJSON() as { project_id: number; name: string });
    }
  });
  return writes;
}

async function renderCheckpoint(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function compositionKey(input: Locator, key: "Enter" | "Escape") {
  await input.dispatchEvent("compositionstart", { data: "日本語" });
  await input.dispatchEvent("keydown", { key, code: key, keyCode: key === "Enter" ? 13 : 27, isComposing: true, bubbles: true });
  await input.dispatchEvent("compositionend", { data: "日本語" });
  // Also cover the conversion-confirmation key event emitted by Safari.
  await input.dispatchEvent("keydown", { key, code: key, keyCode: 229, isComposing: false, bubbles: true });
}

test("timeline adds a trimmed section inline in the sidebar without a native dialog", async ({ page }) => {
  const { projectId, initial } = await fixture(page);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await openTimeline(page, projectId);
  const e = await startSection(page);
  await expect(e.input).toHaveAccessibleName("セクション名");
  const first = await page.locator(`[data-timeline-section-row="${initial[0].id}"]`).boundingBox();
  const input = await e.input.boundingBox();
  expect(first).not.toBeNull();
  expect(input).not.toBeNull();
  expect(input!.x).toBeGreaterThanOrEqual(first!.x);
  expect(input!.x + input!.width).toBeLessThanOrEqual(first!.x + first!.width + 1);
  await e.input.fill("  新しい工程  ");
  const screenshot = test.info().outputPath("wide-inline-section-editor.png");
  await page.screenshot({ path: screenshot });
  await test.info().attach("wide-inline-section-editor", { path: screenshot, contentType: "image/png" });
  const created = sectionResponse(page);
  await e.input.press("Enter");
  expect((await created).request().postDataJSON()).toEqual({ project_id: projectId, name: "新しい工程" });
  await expect(e.draft).toHaveCount(0);
  await expect(e.input).toHaveCount(0);
  const current = await sections(page, projectId);
  expect(current.map((section) => section.name)).toEqual([...initial.map((section) => section.name), "新しい工程"]);
  await expect(page.locator(`[data-timeline-section-row="${current.at(-1)!.id}"]`)).toHaveText("新しい工程");
  expect(dialogs).toEqual([]);
});

test("timeline toolbar section starts the sidebar's trailing draft", async ({ page }) => {
  const { projectId, initial } = await fixture(page);
  await openTimeline(page, projectId);
  await page.getByRole("button", { name: "追加オプション" }).first().click();
  await page.getByRole("menuitem", { name: "セクション", exact: true }).click();
  const e = editor(page);
  await expect(e.draft).toBeVisible();
  await expect(e.input).toBeFocused();
  await e.input.fill("ツールバーの工程");
  const created = sectionResponse(page);
  await e.input.press("Enter");
  await created;
  await expect(e.draft).toHaveCount(0);
  expect((await sections(page, projectId)).map((section) => section.name))
    .toEqual([...initial.map((section) => section.name), "ツールバーの工程"]);
});

test("the inline section editor fits the narrow timeline sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  const { projectId, initial } = await fixture(page);
  await openTimeline(page, projectId);
  const e = await startSection(page);
  await e.input.fill("狭い画面のセクション");
  const section = await page.locator(`[data-timeline-section-row="${initial[0].id}"]`).boundingBox();
  expect(section).not.toBeNull();
  expect(section!.width).toBeLessThanOrEqual(144);
  await expect(e.input).toBeVisible();
  const box = await e.input.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(section!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(section!.x + section!.width + 1);
  const screenshot = test.info().outputPath("narrow-inline-section-editor.png");
  await page.screenshot({ path: screenshot });
  await test.info().attach("narrow-inline-section-editor", { path: screenshot, contentType: "image/png" });
  await e.input.press("Escape");
  await expect(e.draft).toHaveCount(0);
  expect(await sections(page, projectId)).toEqual(initial);
});

test("timeline blur commits the named draft", async ({ page }) => {
  const { projectId } = await fixture(page);
  await openTimeline(page, projectId);
  const writes = sectionWrites(page);
  const e = await startSection(page);
  await e.input.fill("  ぼかしで追加  ");
  const created = sectionResponse(page);
  await e.input.blur();
  await created;
  await expect(e.draft).toHaveCount(0);
  await expect(e.start).toBeVisible();
  expect(writes).toEqual([{ project_id: projectId, name: "ぼかしで追加" }]);
  expect((await sections(page, projectId)).filter((section) => section.name === "ぼかしで追加")).toHaveLength(1);
});

test("timeline Escape discards drafts while empty Enter stays open without a write", async ({ page }) => {
  const { projectId, initial } = await fixture(page);
  await openTimeline(page, projectId);
  const writes = sectionWrites(page);
  let e = await startSection(page);
  await e.input.fill("未保存のセクション");
  await e.input.press("Escape");
  await expect(e.draft).toHaveCount(0);
  await expect(e.start).toBeVisible();
  await expect(e.start).toBeFocused();
  e = await startSection(page);
  await expect(e.input).toHaveValue("");
  await e.input.fill("   ");
  await e.input.press("Enter");
  await expect(e.input).toBeFocused();
  await expect(e.input).toHaveValue("   ");
  await e.input.blur();
  await expect(e.draft).toHaveCount(0);
  await renderCheckpoint(page);
  expect(writes).toEqual([]);
  expect(await sections(page, projectId)).toEqual(initial);
});

test("timeline IME confirmation neither creates nor cancels a section before the following Enter", async ({ page }) => {
  const { projectId } = await fixture(page);
  await openTimeline(page, projectId);
  const writes = sectionWrites(page);
  const e = await startSection(page);
  await e.input.fill("日本語の新しい工程");
  await compositionKey(e.input, "Enter");
  await compositionKey(e.input, "Escape");
  await renderCheckpoint(page);
  await expect(e.input).toBeFocused();
  await expect(e.input).toHaveValue("日本語の新しい工程");
  expect(writes).toEqual([]);
  const created = sectionResponse(page);
  await e.input.press("Enter");
  await created;
  await expect(e.start).toBeVisible();
  expect(writes).toEqual([{ project_id: projectId, name: "日本語の新しい工程" }]);
});

test("timeline repeated Enter and blur while saving create only one section", async ({ page }) => {
  const { projectId } = await fixture(page);
  await openTimeline(page, projectId);
  const writes = sectionWrites(page);
  const e = await startSection(page);
  await e.input.fill("一度だけ追加");
  let release!: () => void;
  let arrive!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { arrive = resolve; });
  await page.route("**/api/sections", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    arrive();
    await gate;
    await route.continue();
  });
  try {
    const created = sectionResponse(page);
    // Dispatch both keys in one turn, before React can disable the control.
    await e.input.evaluate((input) => {
      for (let count = 0; count < 2; count++) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      }
      input.blur();
    });
    await arrived;
    await expect(e.input).toBeDisabled();
    await e.input.dispatchEvent("keydown", { key: "Enter", code: "Enter", bubbles: true });
    await e.input.dispatchEvent("blur");
    await renderCheckpoint(page);
    expect(writes).toEqual([{ project_id: projectId, name: "一度だけ追加" }]);
    release();
    await created;
    await expect(e.draft).toHaveCount(0);
    await expect(e.start).toBeVisible();
    expect((await sections(page, projectId)).filter((section) => section.name === "一度だけ追加")).toHaveLength(1);
    expect(writes).toHaveLength(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("timeline 503 shows an inline warning, retains the draft and supports retry", async ({ page }) => {
  const { projectId, initial } = await fixture(page);
  await openTimeline(page, projectId);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let attempts = 0;
  await page.route("**/api/sections", async (route) => {
    if (route.request().method() === "POST" && ++attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "injected section failure" }) });
      return;
    }
    await route.continue();
  });
  const e = await startSection(page);
  await e.input.fill("  失敗後に再試行  ");
  const failed = sectionResponse(page, 503);
  await e.input.press("Enter");
  await failed;
  await expect(e.wrapper.getByRole("alert")).toHaveText("セクションの追加に失敗しました。もう一度お試しください。");
  await expect(e.input).toHaveValue("  失敗後に再試行  ");
  await expect(e.input).toBeEnabled();
  await expect(e.input).toBeFocused();
  expect(await sections(page, projectId)).toEqual(initial);
  const created = sectionResponse(page);
  await e.input.press("Enter");
  await created;
  await expect(e.draft).toHaveCount(0);
  await expect(e.start).toBeVisible();
  await expect(e.wrapper.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
  expect((await sections(page, projectId)).filter((section) => section.name === "失敗後に再試行")).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("an empty timeline can draft an unsectioned task without first creating a section", async ({ page }) => {
  const { projectId } = await fixture(page, true);
  await openTimeline(page, projectId);
  await expect(async () => {
    await page.locator("[data-timeline-add]").click();
    await expect(page.getByRole("textbox", { name: "新しいタスク名", exact: true })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await page.getByRole("textbox", { name: "新しいタスク名", exact: true }).press("Escape");
  expect(await sections(page, projectId)).toEqual([]);
  const e = await startSection(page);
  await e.input.fill("最初の工程");
  const created = sectionResponse(page);
  await e.input.press("Enter");
  const { id: sectionId } = await (await created).json() as { id: number };
  await expect(page.locator(`[data-timeline-section-row="${sectionId}"]`)).toHaveText("最初の工程");
});

test("opening the section editor preserves the task draft's normal blur save", async ({ page }) => {
  const { projectId } = await fixture(page);
  await openTimeline(page, projectId);
  const taskName = page.getByRole("textbox", { name: "新しいタスク名", exact: true });
  await expect(async () => {
    await page.locator("[data-timeline-canvas]").click({ position: { x: 100, y: 65 } });
    await expect(taskName).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await taskName.fill("工程追加前のタスク");
  const taskCreated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/tasks" && response.request().method() === "POST" && response.status() === 201);
  const e = await startSection(page);
  await taskCreated;
  await expect(page.locator("[data-timeline-draft]")).toHaveCount(0);
  await expect(e.input).toBeVisible();
  await expect(e.input).toBeFocused();
  await e.input.fill("タスク入力後の工程");
  const sectionCreated = sectionResponse(page);
  await e.input.press("Enter");
  await sectionCreated;
  await expect(e.start).toBeVisible();
  const exported = await page.request.get(`/api/projects/${projectId}/export?format=json`);
  expect(exported.status()).toBe(200);
  expect((await exported.json() as { tasks: { name: string }[] }).tasks.filter((task) => task.name === "工程追加前のタスク")).toHaveLength(1);
  expect((await sections(page, projectId)).filter((section) => section.name === "タスク入力後の工程")).toHaveLength(1);
});

for (const role of ["editor", "viewer"] as const) {
  for (const empty of [false, true]) {
    test(`timeline ${role} without configure permission cannot add a section (${empty ? "empty" : "existing sections"})`, async ({ page, browser }) => {
      const { projectId } = await fixture(page, empty);
      expect((await page.request.patch(`/api/projects/${projectId}`, { data: { settings: { who_can_edit: "admins" } } })).status()).toBe(200);
      expect((await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: 2, role } })).status()).toBe(201);
      const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
      try {
        const actor = await other.newPage();
        expect((await actor.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } })).status()).toBe(200);
        await openTimeline(actor, projectId);
        await expect(actor.locator("[data-timeline-section-add]")).toHaveCount(0);
        await expect(actor.locator("[data-add-section-input]")).toHaveCount(0);
        const addTask = actor.locator("[data-timeline-add]");
        if (role === "editor") {
          await expect(addTask).toBeEnabled();
          await expect(async () => {
            await addTask.click();
            await expect(actor.getByRole("textbox", { name: "新しいタスク名", exact: true })).toBeVisible({ timeout: 500 });
          }).toPass({ timeout: 5000 });
          await actor.getByRole("textbox", { name: "新しいタスク名", exact: true }).press("Escape");
        } else {
          await expect(addTask).toBeDisabled();
        }
        const denied = await actor.request.post("/api/sections", { data: { project_id: projectId, name: "権限外の工程" } });
        expect(denied.status()).toBe(403);
        expect((await sections(page, projectId)).filter((section) => section.name === "権限外の工程")).toHaveLength(0);
      } finally {
        await other.close();
      }
    });
  }
}

test("the shared list section editor discards on Escape and saves blur with trimming", async ({ page }) => {
  const { projectId, initial } = await fixture(page);
  await page.goto(`/projects/${projectId}?view=list`);
  const input = page.locator("[data-add-section-input]");
  const start = page.getByRole("button", { name: "＋ セクションを追加", exact: true });
  await expect(async () => {
    if (await start.isVisible()) await start.click();
    await expect(input).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await expect(input).toBeFocused();
  await input.fill("リストで取消");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(start).toBeVisible();
  expect(await sections(page, projectId)).toEqual(initial);
  await start.click();
  await input.fill("  リストの新工程  ");
  const created = sectionResponse(page);
  await input.blur();
  await created;
  await expect(input).toHaveCount(0);
  expect((await sections(page, projectId)).filter((section) => section.name === "リストの新工程")).toHaveLength(1);
});
