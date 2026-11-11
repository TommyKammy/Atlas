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
  if (!page.isClosed()) await page.goto("about:blank");
  const response = await page.request.delete(`/api/projects/${projectId}`);
  if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
});

async function sections(page: Page, projectId: number): Promise<Section[]> {
  const response = await page.request.get(`/api/lookup?project_id=${projectId}`);
  expect(response.status()).toBe(200);
  return await response.json() as Section[];
}

async function fixture(page: Page, { emptySections = false, task = true } = {}) {
  const response = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Inline board section ${test.info().testId} ${Date.now()}` },
  });
  expect(response.status()).toBe(201);
  const { id: projectId } = await response.json() as { id: number };
  fixtures.set(page, projectId);
  const initial = await sections(page, projectId);
  if (emptySections) {
    for (const section of initial) {
      expect((await page.request.delete(`/api/sections/${section.id}`)).status()).toBe(200);
    }
  } else if (task) {
    const created = await page.request.post("/api/tasks", {
      data: { project_id: projectId, section_id: initial[0].id, name: "既存のカード" },
    });
    expect(created.status()).toBe(201);
  }
  return { projectId, initial: emptySections ? [] : initial };
}

async function openBoard(page: Page, projectId: number, group = "section") {
  await page.goto(`/projects/${projectId}?view=board&group=${group}`);
  await expect(page.locator("[data-board-view]")).toHaveAttribute("data-board-group", group);
}

function editor(page: Page) {
  const wrapper = page.locator("[data-board-section-add]");
  return {
    wrapper,
    start: wrapper.getByRole("button", { name: "＋ セクションを追加", exact: true }),
    input: wrapper.locator("[data-add-section-input]"),
    submit: wrapper.getByRole("button", { name: /^追加(?:中…)?$/ }),
    cancel: wrapper.getByRole("button", { name: "キャンセル", exact: true }),
  };
}

async function startSection(page: Page) {
  const e = editor(page);
  // Wait for the idempotent open action to take effect after client hydration.
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
  await input.dispatchEvent("keydown", { key, code: key, keyCode: 229, isComposing: false, bubbles: true });
}

async function capture(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function setShowEmpty(page: Page, visible: boolean) {
  const dialog = page.getByRole("dialog", { name: "ボードのオプション", exact: true });
  await page.locator("[data-board-options-open]").click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: "空のグループを表示", exact: true }).setChecked(visible);
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-board-view]")).toHaveAttribute("data-board-show-empty", String(visible));
}

test("board adds a trimmed section inline to the right of every existing column", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { projectId, initial } = await fixture(page);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await openBoard(page, projectId);
  const e = await startSection(page);
  await e.wrapper.scrollIntoViewIfNeeded();
  const columns = page.locator("[data-board-columns]");
  expect(await columns.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const last = await page.locator("[data-board-column]").last().boundingBox();
  const added = await e.wrapper.boundingBox();
  expect(last).not.toBeNull(); expect(added).not.toBeNull();
  expect(added!.x).toBeGreaterThanOrEqual(last!.x + last!.width + 10);
  expect(Math.abs(added!.y - last!.y)).toBeLessThanOrEqual(1);
  await expect(e.input).toHaveAccessibleName("セクション名");
  await e.input.fill("  ボードの新しい工程  ");
  await capture(page, "wide-board-section-editor");
  const created = sectionResponse(page);
  await e.input.press("Enter");
  const response = await created;
  expect(response.request().postDataJSON()).toEqual({ project_id: projectId, name: "ボードの新しい工程" });
  const { id } = await response.json() as { id: number };
  await expect(e.start).toBeVisible();
  await expect(page.locator(`[data-board-column="s${id}"]`)).toContainText("ボードの新しい工程");
  await expect(page.locator("[data-board-column]").last()).toHaveAttribute("data-board-column", `s${id}`);
  await expect(e.start).toBeFocused();
  await expect(e.start).toBeInViewport({ ratio: 1 });
  expect((await sections(page, projectId)).map((section) => section.name)).toEqual([...initial.map((section) => section.name), "ボードの新しい工程"]);
  expect(dialogs).toEqual([]);
});

test("narrow board keeps the composer within its column and blur waits for explicit Add", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  const { projectId, initial } = await fixture(page);
  await openBoard(page, projectId);
  const writes = sectionWrites(page);
  const e = await startSection(page);
  await e.input.fill("  狭い画面で追加  ");
  await e.input.blur();
  await renderCheckpoint(page);
  expect(writes).toEqual([]);
  expect(await sections(page, projectId)).toEqual(initial);
  await expect(e.input).toHaveValue("  狭い画面で追加  ");
  await e.wrapper.scrollIntoViewIfNeeded();
  const wrapper = await e.wrapper.boundingBox();
  expect(wrapper).not.toBeNull();
  for (const control of [e.input, e.submit, e.cancel]) {
    await expect(control).toBeInViewport();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(wrapper!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(wrapper!.x + wrapper!.width + 1);
  }
  await capture(page, "narrow-board-section-editor");
  const created = sectionResponse(page);
  await e.submit.click();
  const { id } = await (await created).json() as { id: number };
  await expect(page.locator(`[data-board-column="s${id}"]`)).toContainText("狭い画面で追加");
  await expect(e.start).toBeVisible();
  await expect(e.start).toBeFocused();
  await expect(e.start).toBeInViewport({ ratio: 1 });
  expect(writes).toEqual([{ project_id: projectId, name: "狭い画面で追加" }]);
});

test("board Escape and Cancel discard drafts and restore focus while empty confirmation sends nothing", async ({ page }) => {
  const { projectId, initial } = await fixture(page);
  await openBoard(page, projectId);
  const writes = sectionWrites(page);
  let e = await startSection(page);
  await e.input.fill("取消される工程");
  await e.input.press("Escape");
  await expect(e.start).toBeFocused();
  e = await startSection(page);
  await expect(e.input).toHaveValue("");
  await e.input.fill("   ");
  await e.input.press("Enter");
  await expect(e.input).toBeFocused();
  await expect(e.input).toHaveValue("   ");
  await e.submit.click();
  await expect(e.input).toHaveValue("   ");
  await e.cancel.click();
  await expect(e.start).toBeFocused();
  await renderCheckpoint(page);
  expect(writes).toEqual([]);
  expect(await sections(page, projectId)).toEqual(initial);
});

test("board IME Enter and Escape confirmation do not submit or cancel the section draft", async ({ page }) => {
  const { projectId } = await fixture(page);
  await openBoard(page, projectId);
  const writes = sectionWrites(page);
  const e = await startSection(page);
  await e.input.fill("日本語で作る工程");
  await compositionKey(e.input, "Enter");
  await compositionKey(e.input, "Escape");
  await renderCheckpoint(page);
  await expect(e.input).toBeFocused();
  await expect(e.input).toHaveValue("日本語で作る工程");
  expect(writes).toEqual([]);
  const created = sectionResponse(page);
  await e.input.press("Enter");
  await created;
  await expect(e.start).toBeVisible();
  expect(writes).toEqual([{ project_id: projectId, name: "日本語で作る工程" }]);
});

test("board repeated Enter in one turn and blur cannot create duplicate sections", async ({ page }) => {
  const { projectId } = await fixture(page);
  await openBoard(page, projectId);
  const writes = sectionWrites(page);
  const e = await startSection(page);
  await e.input.fill("一度だけの工程");
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
    await e.input.evaluate((input) => {
      for (let index = 0; index < 2; index++) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      }
      input.blur();
    });
    await arrived;
    await expect(e.input).toBeDisabled();
    await expect(e.submit).toBeDisabled();
    await expect(e.cancel).toBeDisabled();
    await e.input.dispatchEvent("keydown", { key: "Enter", code: "Enter", bubbles: true });
    await renderCheckpoint(page);
    expect(writes).toEqual([{ project_id: projectId, name: "一度だけの工程" }]);
    release();
    await created;
    await expect(e.start).toBeVisible();
    expect((await sections(page, projectId)).filter((section) => section.name === "一度だけの工程")).toHaveLength(1);
    expect(writes).toHaveLength(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("board 503 retains the draft with an accessible warning and allows a successful retry", async ({ page }) => {
  const { projectId, initial } = await fixture(page);
  await openBoard(page, projectId);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let attempts = 0;
  await page.route("**/api/sections", async (route) => {
    if (route.request().method() === "POST" && ++attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "injected board section failure" }) });
      return;
    }
    await route.continue();
  });
  const e = await startSection(page);
  await e.input.fill("  再試行する工程  ");
  const failed = sectionResponse(page, 503);
  await e.input.press("Enter");
  await failed;
  await expect(e.wrapper.getByRole("alert")).toHaveText("セクションの追加に失敗しました。もう一度お試しください。");
  await expect(e.input).toHaveAttribute("aria-invalid", "true");
  await expect(e.input).toHaveValue("  再試行する工程  ");
  await expect(e.input).toBeEnabled();
  await expect(e.submit).toBeEnabled();
  expect(await sections(page, projectId)).toEqual(initial);
  const created = sectionResponse(page);
  await e.submit.click();
  const { id } = await (await created).json() as { id: number };
  await expect(e.start).toBeVisible();
  await expect(e.wrapper.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(`[data-board-column="s${id}"]`)).toContainText("再試行する工程");
  expect(attempts).toBe(2);
  expect((await sections(page, projectId)).filter((section) => section.name === "再試行する工程")).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const emptySections of [false, true]) {
  test(`board without tasks can add a section (${emptySections ? "zero" : "existing"} sections)`, async ({ page }) => {
    const { projectId, initial } = await fixture(page, { emptySections, task: false });
    await openBoard(page, projectId);
    await expect(page.locator("[data-board-column]")).toHaveCount(initial.length);
    const e = await startSection(page);
    await e.input.fill("空のボードの工程");
    const created = sectionResponse(page);
    await e.input.press("Enter");
    const { id } = await (await created).json() as { id: number };
    const column = page.locator(`[data-board-column="s${id}"]`);
    await expect(column).toContainText("空のボードの工程");
    await expect(column.locator("[data-add-task-open]")).toBeVisible();
    await expect(page.locator("[data-board-column]")).toHaveCount(initial.length + 1);
  });
}

test("hidden empty groups still reveal multiple new sections until the user changes that option", async ({ page }) => {
  const { projectId, initial } = await fixture(page);
  await openBoard(page, projectId);
  await startSection(page);
  await editor(page).cancel.click();
  await setShowEmpty(page, false);
  await expect(page.locator("[data-board-column]")).toHaveCount(1);
  const createdIds: number[] = [];
  for (const name of ["最初に作った空の工程", "次に作った空の工程"]) {
    const e = await startSection(page);
    await e.input.fill(name);
    const created = sectionResponse(page);
    await e.input.press("Enter");
    createdIds.push((await (await created).json() as { id: number }).id);
    await expect(page.locator(`[data-board-column="s${createdIds.at(-1)}"]`)).toContainText(name);
    await expect(page.locator("[data-board-view]")).toHaveAttribute("data-board-show-empty", "false");
    await expect(page.locator("[data-board-column]")).toHaveCount(1 + createdIds.length);
  }
  await setShowEmpty(page, true);
  await expect(page.locator("[data-board-column]")).toHaveCount(initial.length + 2);
  await setShowEmpty(page, false);
  await expect(page.locator("[data-board-column]")).toHaveCount(1);
  for (const id of createdIds) await expect(page.locator(`[data-board-column="s${id}"]`)).toHaveCount(0);
  expect((await sections(page, projectId)).length).toBe(initial.length + 2);
});

for (const group of ["status", "assignee"]) {
  test(`board ${group} grouping does not expose section creation as a group-choice editor`, async ({ page }) => {
    const { projectId, initial } = await fixture(page);
    const writes = sectionWrites(page);
    await openBoard(page, projectId, group);
    await expect(page.locator("[data-board-column]")).toHaveCount(1);
    await expect(page.locator("[data-board-section-add]")).toHaveCount(0);
    await expect(page.locator("[data-add-section-input]")).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await sections(page, projectId)).toEqual(initial);
  });
}

for (const role of ["editor", "viewer"] as const) {
  for (const emptySections of [false, true]) {
    test(`board ${role} without configure permission cannot add a section (${emptySections ? "zero" : "existing"} sections)`, async ({ page, browser }) => {
      const { projectId, initial } = await fixture(page, { emptySections });
      expect((await page.request.patch(`/api/projects/${projectId}`, { data: { settings: { who_can_edit: "admins" } } })).status()).toBe(200);
      expect((await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: 2, role } })).status()).toBe(201);
      const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
      try {
        const actor = await other.newPage();
        expect((await actor.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } })).status()).toBe(200);
        await openBoard(actor, projectId);
        await expect(actor.locator("[data-board-section-add]")).toHaveCount(0);
        await expect(actor.locator("[data-add-section-input]")).toHaveCount(0);
        expect((await actor.request.post("/api/sections", { data: { project_id: projectId, name: "権限外の工程" } })).status()).toBe(403);
        expect(await sections(page, projectId)).toEqual(initial);
      } finally {
        await other.close();
      }
    });
  }
}

test("board delegated editor with configure permission can add sections", async ({ page, browser }) => {
  const { projectId } = await fixture(page);
  expect((await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: 2, role: "editor" } })).status()).toBe(201);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const actor = await other.newPage();
    expect((await actor.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } })).status()).toBe(200);
    await openBoard(actor, projectId);
    const e = await startSection(actor);
    await e.input.fill("編集者が追加した工程");
    const created = sectionResponse(actor);
    await e.input.press("Enter");
    const { id } = await (await created).json() as { id: number };
    await expect(actor.locator(`[data-board-column="s${id}"]`)).toContainText("編集者が追加した工程");
    expect((await sections(page, projectId)).filter((section) => section.name === "編集者が追加した工程")).toHaveLength(1);
  } finally {
    await other.close();
  }
});
