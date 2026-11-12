import { expect, test, type Page, type Response } from "@playwright/test";
import { shiftDay } from "../../lib/calendar";

const credentials = {
  email: process.env.E2E_EMAIL ?? "admin@example.com",
  password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
};
const fixtures = new WeakMap<Page, number[]>();
type Section = { id: number; name: string };
type Task = { id: number; section_id: number | null; name: string; start_on: string; due_on: string };

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test.afterEach(async ({ page }, info) => {
  info.setTimeout(25_000);
  await page.mouse.up().catch(() => undefined);
  await page.unrouteAll({ behavior: "wait" });
  if (!page.isClosed()) await page.goto("about:blank");
  // Every project belongs to this test; remove secondary homes before primary.
  for (const projectId of (fixtures.get(page) ?? []).toReversed()) {
    const response = await page.request.delete(`/api/projects/${projectId}`);
    if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
  }
});

async function project(page: Page) {
  const response = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Timeline section move ${test.info().testId} ${Date.now()}` },
  });
  expect(response.status()).toBe(201);
  const { id: projectId } = await response.json() as { id: number };
  fixtures.set(page, [...(fixtures.get(page) ?? []), projectId]);
  const lookup = await page.request.get(`/api/lookup?project_id=${projectId}`);
  expect(lookup.status()).toBe(200);
  const sections = (await lookup.json() as Section[]).map((section) => ({ ...section, id: Number(section.id) }));
  return { projectId, sections };
}

async function createTask(page: Page, projectId: number, sectionId: number | null, name = "Section move task", extra: Record<string, unknown> = {}) {
  const start = new Date().toLocaleDateString("en-CA");
  const due = shiftDay(start, 6);
  const response = await page.request.post("/api/tasks", {
    data: { project_id: projectId, section_id: sectionId, name, start_on: start, due_on: due, ...extra },
  });
  expect(response.status()).toBe(201);
  const { id: taskId } = await response.json() as { id: number };
  return { taskId, start, due };
}

async function fixture(page: Page, extra: Record<string, unknown> = {}) {
  const p = await project(page);
  const t = await createTask(page, p.projectId, p.sections[0].id, "Section move task", extra);
  return { ...p, ...t };
}

async function pin(page: Page, projectId: number, taskId: number, rowIndex: number) {
  const response = await page.request.put(`/api/tasks/${taskId}/timeline-row`, {
    data: { project_id: projectId, row_index: rowIndex },
  });
  expect(response.status()).toBe(200);
}

async function readTask(page: Page, projectId: number, taskId: number): Promise<Task> {
  const response = await page.request.get(`/api/projects/${projectId}/export?format=json`);
  expect(response.status()).toBe(200);
  const task = (await response.json() as { tasks: Task[] }).tasks.find((entry) => Number(entry.id) === taskId);
  expect(task).toBeTruthy();
  return { ...task!, section_id: task!.section_id === null ? null : Number(task!.section_id) };
}

async function openTimeline(page: Page, projectId: number) {
  await page.goto(`/projects/${projectId}?view=timeline&zoom=2`);
  const zoom = page.getByRole("button", { name: "ズームレベル: 週" });
  const menu = page.locator("[data-timeline-zoom-menu]");
  // Initial scroll and hydration must finish before measuring drag coordinates.
  await expect(async () => {
    await zoom.click();
    await expect(menu).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await menu.locator('[data-timeline-zoom-option="週"]').click();
  await expect(menu).toBeHidden();
}

function bar(page: Page, taskId: number) {
  return page.locator(`[data-timeline-row="${taskId}"] [data-timeline-bar="${taskId}"]`);
}

function groupBar(page: Page, taskId: number, sectionId: number | null) {
  return page.locator(`[data-timeline-group="${sectionId ?? 0}"] [data-timeline-bar="${taskId}"]`);
}

function moveResponse(page: Page, taskId: number, status = 200): Promise<Response> {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/tasks/${taskId}/timeline-row` &&
    response.request().method() === "PUT" && response.status() === status);
}

async function beginDrag(page: Page, taskId: number, handle?: "start" | "end") {
  const target = handle
    ? page.locator(`[data-timeline-row="${taskId}"] [data-timeline-handle="${handle}"]`)
    : bar(page, taskId);
  await target.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
  await expect(target).toBeInViewport();
  let box = await target.boundingBox();
  expect(box).not.toBeNull();
  let x = box!.x + box!.width / 2;
  // Hovering reveals a completion toggle; the top of the central grip avoids it.
  let y = box!.y + 5;
  await page.mouse.move(x, y);
  // One-day markers expand from 8px on hover. Recenter after that render so
  // their newly exposed edge handle cannot intercept a body-move gesture.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  box = await target.boundingBox();
  expect(box).not.toBeNull();
  x = box!.x + box!.width / 2;
  y = box!.y + 5;
  await page.mouse.move(x, y);
  await expect.poll(() => page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest(".tl-bar")
      ?.closest("[data-timeline-row]")?.getAttribute("data-timeline-row"), { x, y })).toBe(String(taskId));
  await expect.poll(() => page.evaluate(({ x, y, handle, taskId }) => {
    const hit = document.elementFromPoint(x, y)?.closest(".tl-bar");
    // Hover can raise the bar above its transparent handle. Its edge hit test
    // starts the same resize gesture, which the fixed-edge/date checks verify.
    return hit?.getAttribute("data-timeline-bar") === String(taskId) ||
      Boolean(handle && hit?.getAttribute("data-timeline-handle") === handle);
  }, { x, y, handle, taskId })).toBe(true);
  await page.mouse.down();
  return { target, x, y };
}

async function rowDrag(page: Page, taskId: number, sectionId: number | null, row = 0, release = true) {
  const started = await beginDrag(page, taskId);
  let y = started.y;
  const marker = page.locator("[data-timeline-row-drop]");
  // Insertion opens a visible 40px gap. Follow the actual displayed section
  // header if a gap encountered along the drag path shifts that section.
  await expect(async () => {
    const header = await page.locator(`[data-timeline-section-row="${sectionId ?? 0}"]`).boundingBox();
    expect(header).not.toBeNull();
    y = header!.y + 10 + row * 40;
    await page.mouse.move(started.x, y, { steps: 8 });
    await expect(marker).toHaveAttribute("data-timeline-row-drop-section", sectionId === null ? "none" : String(sectionId), { timeout: 300 });
    await expect(marker).toHaveAttribute("data-timeline-row-drop-index", String(row), { timeout: 300 });
  }).toPass({ timeout: 4000 });
  await expect(marker).toContainText(new RegExp(`(?:行|挿入) ${row + 1}`));
  if (release) await page.mouse.up();
  return { ...started, y };
}

async function expectPinned(page: Page, taskId: number, sectionId: number | null, row = 0) {
  const target = groupBar(page, taskId, sectionId);
  await expect(target).toHaveAttribute("data-timeline-row-locked", "true");
  await expect(target).toHaveAttribute("data-timeline-lane", String(row));
  await expect(target).not.toHaveClass(/shadow-lg/);
  await expect(page.locator("[data-timeline-row-drop]")).toHaveCount(0);
}

test("vertical timeline drag changes section and row atomically while preserving dates after reload", async ({ page }) => {
  const f = await fixture(page);
  await pin(page, f.projectId, f.taskId, 2);
  await openTimeline(page, f.projectId);
  const saved = moveResponse(page, f.taskId);
  await rowDrag(page, f.taskId, f.sections[1].id, 0, false);
  await expect(page.locator("[data-timeline-drop-label]")).toBeInViewport({ ratio: 1 });
  const screenshot = test.info().outputPath("timeline-cross-section-drop-preview.png");
  await page.screenshot({ path: screenshot });
  await test.info().attach("timeline-cross-section-drop-preview", { path: screenshot, contentType: "image/png" });
  await page.mouse.up();
  const response = await saved;
  expect(response.request().postDataJSON()).toMatchObject({
    project_id: f.projectId, section_id: f.sections[1].id, row_index: 0, expected_section_id: f.sections[0].id,
    expected_updated_at: expect.any(String), expected_task_updated_at: expect.any(String),
  });
  await expectPinned(page, f.taskId, f.sections[1].id);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[1].id, start_on: f.start, due_on: f.due });
  await page.reload();
  await expectPinned(page, f.taskId, f.sections[1].id);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[1].id, start_on: f.start, due_on: f.due });
});

test("same-section vertical drag still pins the selected row without changing dates", async ({ page }) => {
  const f = await fixture(page);
  const anchor = await createTask(page, f.projectId, f.sections[0].id, "Anchor in row two");
  await pin(page, f.projectId, anchor.taskId, 2);
  await openTimeline(page, f.projectId);
  const saved = moveResponse(page, f.taskId);
  await rowDrag(page, f.taskId, f.sections[0].id, 1);
  expect((await saved).request().postDataJSON()).toMatchObject({ section_id: f.sections[0].id, row_index: 1 });
  await expectPinned(page, f.taskId, f.sections[0].id, 1);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[0].id, start_on: f.start, due_on: f.due });
});

test("dropping on a collapsed section moves to row zero and expands the destination", async ({ page }) => {
  const f = await fixture(page);
  await openTimeline(page, f.projectId);
  const header = page.locator(`[data-timeline-section-row="${f.sections[1].id}"]`);
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  const saved = moveResponse(page, f.taskId);
  await rowDrag(page, f.taskId, f.sections[1].id);
  await saved;
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expectPinned(page, f.taskId, f.sections[1].id);
});

test("tasks move into and out of the no-section bucket with null API sections", async ({ page }) => {
  const f = await fixture(page);
  await openTimeline(page, f.projectId);
  await expect(page.locator('[data-timeline-section-row="0"]')).toContainText("セクションなし");
  let saved = moveResponse(page, f.taskId);
  await rowDrag(page, f.taskId, null);
  expect((await saved).request().postDataJSON()).toMatchObject({ section_id: null });
  await expectPinned(page, f.taskId, null);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: null, start_on: f.start, due_on: f.due });
  saved = moveResponse(page, f.taskId);
  await rowDrag(page, f.taskId, f.sections[1].id);
  expect((await saved).request().postDataJSON()).toMatchObject({ section_id: f.sections[1].id, expected_section_id: null });
  await expectPinned(page, f.taskId, f.sections[1].id);
  await page.reload();
  await expectPinned(page, f.taskId, f.sections[1].id);
});

test("multi-homed timeline moves update only the current project's section and pin", async ({ page }) => {
  const primary = await fixture(page);
  const secondary = await project(page);
  expect((await page.request.post("/api/memberships", {
    data: { task_id: primary.taskId, project_id: secondary.projectId, section_id: secondary.sections[0].id },
  })).status()).toBe(201);
  await pin(page, primary.projectId, primary.taskId, 2);
  await pin(page, secondary.projectId, primary.taskId, 1);
  await openTimeline(page, secondary.projectId);
  const saved = moveResponse(page, primary.taskId);
  await rowDrag(page, primary.taskId, secondary.sections[1].id);
  expect((await saved).request().postDataJSON()).toMatchObject({ project_id: secondary.projectId, section_id: secondary.sections[1].id });
  await expectPinned(page, primary.taskId, secondary.sections[1].id);
  expect(await readTask(page, secondary.projectId, primary.taskId)).toMatchObject({ section_id: secondary.sections[1].id, start_on: primary.start, due_on: primary.due });
  expect(await readTask(page, primary.projectId, primary.taskId)).toMatchObject({ section_id: primary.sections[0].id, start_on: primary.start, due_on: primary.due });
  await openTimeline(page, primary.projectId);
  await expectPinned(page, primary.taskId, primary.sections[0].id, 2);
  await openTimeline(page, secondary.projectId);
  await expectPinned(page, primary.taskId, secondary.sections[1].id);
});

for (const mode of ["move", "start", "end"] as const) {
  test(`horizontal ${mode} drag preserves section and the opposite date edge`, async ({ page }) => {
    const f = await fixture(page);
    await openTimeline(page, f.projectId);
    const source = bar(page, f.taskId);
    const dayWidth = Number(await page.locator("[data-timeline-canvas]").getAttribute("data-timeline-day-width"));
    const point = await beginDrag(page, f.taskId, mode === "move" ? undefined : mode);
    const before = await source.boundingBox();
    expect(before).not.toBeNull();
    await page.mouse.move(point.x + dayWidth, point.y, { steps: 5 });
    await expect(source).toHaveClass(/shadow-lg/);
    const after = await source.boundingBox();
    expect(after).not.toBeNull();
    if (mode === "start") expect(Math.abs(after!.x + after!.width - before!.x - before!.width)).toBeLessThanOrEqual(1);
    if (mode === "end") expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/tasks/${f.taskId}` && response.request().method() === "PATCH" && response.status() === 200);
    await page.mouse.up();
    const body = (await saved).request().postDataJSON() as Record<string, unknown>;
    expect(body).not.toHaveProperty("section_id");
    expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({
      section_id: f.sections[0].id,
      start_on: mode === "end" ? f.start : shiftDay(f.start, 1),
      due_on: mode === "start" ? f.due : shiftDay(f.due, 1),
    });
    await expect(groupBar(page, f.taskId, f.sections[0].id)).not.toHaveClass(/shadow-lg/);
  });
}

for (const status of [403, 409, 503]) {
  test(`timeline section move ${status} restores the source preview and permits retry`, async ({ page }) => {
    const f = await fixture(page);
    await openTimeline(page, f.projectId);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let attempts = 0;
    await page.route(`**/api/tasks/${f.taskId}/timeline-row`, async (route) => {
      if (route.request().method() === "PUT" && ++attempts === 1) {
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: `section move ${status}` }) });
        return;
      }
      await route.continue();
    });
    const failed = moveResponse(page, f.taskId, status);
    await rowDrag(page, f.taskId, f.sections[1].id, 0, false);
    await expect(bar(page, f.taskId)).toHaveClass(/shadow-lg/);
    await page.mouse.up();
    await failed;
    await expect(groupBar(page, f.taskId, f.sections[0].id)).not.toHaveClass(/shadow-lg/);
    await expect(page.locator("[data-timeline-row-drop]")).toHaveCount(0);
    await expect(groupBar(page, f.taskId, f.sections[1].id)).toHaveCount(0);
    expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[0].id, start_on: f.start, due_on: f.due });
    const retried = moveResponse(page, f.taskId);
    await rowDrag(page, f.taskId, f.sections[1].id);
    await retried;
    await expectPinned(page, f.taskId, f.sections[1].id);
    expect(attempts).toBe(2);
    expect(errors).toEqual([]);
  });
}

for (const reason of ["pointercancel", "lostpointercapture"] as const) {
  test(`timeline section drag ${reason} cancels without a write and permits the next drag`, async ({ page }) => {
    const f = await fixture(page);
    await openTimeline(page, f.projectId);
    const source = bar(page, f.taskId);
    await source.evaluate((element) => element.addEventListener("pointerdown", (event) => {
      (element as HTMLElement).dataset.testPointerId = String((event as PointerEvent).pointerId);
    }, { capture: true, once: true }));
    let writes = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === `/api/tasks/${f.taskId}/timeline-row` && request.method() === "PUT") writes++;
    });
    const started = await rowDrag(page, f.taskId, f.sections[1].id, 0, false);
    const pointerId = Number(await source.getAttribute("data-test-pointer-id"));
    expect(pointerId).toBeGreaterThan(0);
    expect(await source.evaluate((element, pointer) => element.hasPointerCapture(pointer), pointerId)).toBe(true);
    if (reason === "pointercancel") {
      await source.dispatchEvent(reason, { pointerId, pointerType: "mouse", isPrimary: true });
    } else {
      await source.evaluate((element, pointer) => element.releasePointerCapture(pointer), pointerId);
      await page.mouse.move(started.x + 1, started.y);
    }
    await expect(source).not.toHaveClass(/shadow-lg/);
    await expect(page.locator("[data-timeline-row-drop]")).toHaveCount(0);
    await page.mouse.up();
    expect(writes).toBe(0);
    expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[0].id, start_on: f.start, due_on: f.due });
    const saved = moveResponse(page, f.taskId);
    await rowDrag(page, f.taskId, f.sections[1].id);
    await saved;
    await expectPinned(page, f.taskId, f.sections[1].id);
    expect(writes).toBe(1);
  });
}

test("a stationary row drag follows vertical scrolling when resolving the destination section", async ({ page }) => {
  const f = await fixture(page);
  const middle = await createTask(page, f.projectId, f.sections[1].id, "Tall middle section");
  await pin(page, f.projectId, middle.taskId, 15);
  const tail = await page.request.post("/api/sections", { data: { project_id: f.projectId, name: "Scroll space" } });
  expect(tail.status()).toBe(201);
  const tailId = (await tail.json() as { id: number }).id;
  const trailing = await createTask(page, f.projectId, tailId, "Trailing scroll space");
  await pin(page, f.projectId, trailing.taskId, 25);
  await openTimeline(page, f.projectId);
  const started = await beginDrag(page, f.taskId);
  const pointerY = started.y + 60;
  await page.mouse.move(started.x, pointerY, { steps: 5 });
  await expect(page.locator("[data-timeline-row-drop]")).toHaveAttribute("data-timeline-row-drop-section", String(f.sections[1].id));
  const header = page.locator(`[data-timeline-section-row="${f.sections[2].id}"]`);
  const box = await header.boundingBox();
  expect(box).not.toBeNull();
  const delta = box!.y + 20 - pointerY;
  expect(delta).toBeGreaterThan(200);
  const main = page.locator("main");
  const before = await main.evaluate((element) => element.scrollTop);
  await main.evaluate((element, offset) => { element.scrollTop += offset; }, delta);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(before + 200);
  // No pointermove occurs between scrolling and dropping.
  await expect(page.locator("[data-timeline-row-drop]")).toHaveAttribute("data-timeline-row-drop-section", String(f.sections[2].id));
  await expect.poll(async () => {
    const preview = await bar(page, f.taskId).boundingBox();
    return preview === null ? Infinity : Math.abs(preview.y + 5 - pointerY);
  }).toBeLessThanOrEqual(2);
  const saved = moveResponse(page, f.taskId);
  await page.mouse.up();
  await saved;
  await expectPinned(page, f.taskId, f.sections[2].id);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[2].id, start_on: f.start, due_on: f.due });
});

test("active filters and a date sort still permit project-scoped section and row movement", async ({ page }) => {
  const f = await fixture(page, { assignee_id: 1 });
  expect((await page.request.put("/api/view-state", {
    data: { project_id: f.projectId, view: "timeline", state: { sort: "due", hide_completed: true, assignee: "1" } },
  })).status()).toBe(200);
  await openTimeline(page, f.projectId);
  await expect(page.locator("[data-timeline-zoom]")).toHaveAttribute("data-timeline-sort", "due");
  await expect(page.locator("[data-timeline-zoom]")).toHaveAttribute("data-timeline-assignee", "1");
  await expect(page.locator("[data-timeline-zoom]")).toHaveAttribute("data-timeline-hide-completed", "true");
  const saved = moveResponse(page, f.taskId);
  await rowDrag(page, f.taskId, f.sections[1].id);
  expect((await saved).request().postDataJSON()).toMatchObject({ section_id: f.sections[1].id, row_index: 0 });
  await expectPinned(page, f.taskId, f.sections[1].id);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[1].id, start_on: f.start, due_on: f.due });
});

test("keyboard row movement and adjacent-section movement include the no-section bucket", async ({ page }) => {
  const f = await fixture(page);
  await openTimeline(page, f.projectId);
  await bar(page, f.taskId).focus();
  let saved = moveResponse(page, f.taskId);
  await bar(page, f.taskId).press("Alt+ArrowDown");
  expect((await saved).request().postDataJSON()).toMatchObject({ project_id: f.projectId, row_index: 1 });
  await expectPinned(page, f.taskId, f.sections[0].id, 1);
  for (const destination of [f.sections[1].id, f.sections[2].id, null]) {
    saved = moveResponse(page, f.taskId);
    await bar(page, f.taskId).press("Alt+Shift+ArrowDown");
    expect((await saved).request().postDataJSON()).toMatchObject({ section_id: destination, row_index: 0 });
    await expectPinned(page, f.taskId, destination);
  }
  saved = moveResponse(page, f.taskId);
  await bar(page, f.taskId).press("Alt+Shift+ArrowUp");
  await saved;
  await expectPinned(page, f.taskId, f.sections[2].id);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[2].id, start_on: f.start, due_on: f.due });
});

test("dropping above the timeline rows cancels rather than moving dates or sections", async ({ page }) => {
  const f = await fixture(page);
  await openTimeline(page, f.projectId);
  let writes = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(`/api/tasks/${f.taskId}`) && ["PUT", "PATCH"].includes(request.method())) writes++;
  });
  const started = await beginDrag(page, f.taskId);
  const canvas = await page.locator("[data-timeline-canvas]").boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.move(started.x, canvas!.y + 5, { steps: 5 });
  await expect(page.locator("[data-timeline-row-drop]")).toHaveCount(0);
  await page.mouse.up();
  await expect(groupBar(page, f.taskId, f.sections[0].id)).not.toHaveClass(/shadow-lg/);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[0].id, start_on: f.start, due_on: f.due });
  expect(writes).toBe(0);
});

test("a collapsed no-section canvas row opens a usable draft after Escape and saves an unsectioned task", async ({ page }) => {
  const f = await fixture(page);
  await openTimeline(page, f.projectId);
  const header = page.locator('[data-timeline-section-row="0"]');
  const input = page.getByRole("textbox", { name: "新しいタスク名", exact: true });
  const clickCollapsedRow = async () => {
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
    const row = await header.boundingBox();
    const scroller = await page.locator(".timeline-scroll").boundingBox();
    expect(row).not.toBeNull(); expect(scroller).not.toBeNull();
    await page.mouse.click(scroller!.x + scroller!.width / 2, row!.y + 20);
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(input).toBeFocused();
  };
  await clickCollapsedRow();
  await input.fill("取り消すセクションなしタスク");
  await input.press("Escape");
  await expect(page.locator("[data-timeline-draft]")).toHaveCount(0);
  // Cancellation must clear both the rendered draft and its ref gate.
  await clickCollapsedRow();
  await input.fill("セクションなしで作成");
  const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/tasks" && response.request().method() === "POST" && response.status() === 201);
  await input.press("Enter");
  const response = await created;
  expect(response.request().postDataJSON()).toMatchObject({ project_id: f.projectId, section_id: null, name: "セクションなしで作成" });
  const { id: taskId } = await response.json() as { id: number };
  await expect(groupBar(page, taskId, null)).toBeVisible();
  expect(await readTask(page, f.projectId, taskId)).toMatchObject({ section_id: null, name: "セクションなしで作成" });
  await page.reload();
  await expect(groupBar(page, taskId, null)).toBeVisible();
  expect((await readTask(page, f.projectId, taskId)).section_id).toBeNull();
});

test("milestone and one-day marker bodies support vertical section movement without changing dates", async ({ page }) => {
  const f = await project(page);
  const date = new Date().toLocaleDateString("en-CA");
  const tasks = [];
  for (const milestone of [false, true]) {
    tasks.push(await createTask(page, f.projectId, f.sections[0].id, milestone ? "Milestone marker" : "One-day marker", {
      start_on: date, due_on: date, is_milestone: milestone,
    }));
  }
  await openTimeline(page, f.projectId);
  for (const { taskId } of tasks) {
    const saved = moveResponse(page, taskId);
    await rowDrag(page, taskId, f.sections[1].id);
    expect((await saved).request().postDataJSON()).toMatchObject({ section_id: f.sections[1].id, row_index: 0 });
    await expectPinned(page, taskId, f.sections[1].id);
    expect(await readTask(page, f.projectId, taskId)).toMatchObject({ section_id: f.sections[1].id, start_on: date, due_on: date });
  }
});

test("row drag auto-scrolls the main page instead of the horizontal scroller and stops after cancellation", async ({ page }) => {
  const f = await fixture(page);
  await pin(page, f.projectId, f.taskId, 18);
  const tail = await createTask(page, f.projectId, f.sections[2].id, "Auto-scroll trailing space");
  await pin(page, f.projectId, tail.taskId, 30);
  await openTimeline(page, f.projectId);
  const source = bar(page, f.taskId);
  // Keep the starting bar near the lower edge rather than centering it.
  await source.evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "center" }));
  await expect(source).toBeInViewport();
  await source.evaluate((element) => element.addEventListener("pointerdown", (event) => {
    (element as HTMLElement).dataset.testPointerId = String((event as PointerEvent).pointerId);
  }, { capture: true, once: true }));
  const point = await source.boundingBox();
  const main = page.locator("main");
  const mainBox = await main.boundingBox();
  expect(point).not.toBeNull(); expect(mainBox).not.toBeNull();
  const x = point!.x + point!.width / 2;
  const y = point!.y + 5;
  const bottom = Math.min(mainBox!.y + mainBox!.height, 1000) - 4;
  const before = await main.evaluate((element) => element.scrollTop);
  expect(await main.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(300);
  let writes = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/tasks/${f.taskId}/timeline-row` && request.method() === "PUT") writes++;
  });
  await page.mouse.move(x, y);
  await expect.poll(() => page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest(".tl-bar")?.closest("[data-timeline-row]")?.getAttribute("data-timeline-row"), { x, y })).toBe(String(f.taskId));
  await page.mouse.down();
  await page.mouse.move(x, bottom, { steps: 5 });
  await expect(source).toHaveClass(/shadow-lg/);
  // The pointer stays still while the animation frame loop advances the page.
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(before + 14);
  expect(await page.locator(".timeline-scroll").evaluate((element) => element.scrollTop)).toBe(0);
  const pointerId = Number(await source.getAttribute("data-test-pointer-id"));
  expect(pointerId).toBeGreaterThan(0);
  await source.dispatchEvent("pointercancel", { pointerId, pointerType: "mouse", isPrimary: true });
  await page.mouse.up();
  await expect(source).not.toHaveClass(/shadow-lg/);
  await expect(page.locator("[data-timeline-row-drop]")).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const stopped = await main.evaluate((element) => element.scrollTop);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await main.evaluate((element) => element.scrollTop)).toBe(stopped);
  expect(writes).toBe(0);
  expect((await readTask(page, f.projectId, f.taskId)).section_id).toBe(f.sections[0].id);
});

test("filtering away the pointer-capture owner cancels its drag and allows a later move", async ({ page }) => {
  const f = await fixture(page);
  expect((await page.request.patch(`/api/tasks/${f.taskId}`, { data: { completed: true } })).status()).toBe(200);
  await openTimeline(page, f.projectId);
  let writes = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/tasks/${f.taskId}/timeline-row` && request.method() === "PUT") writes++;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await rowDrag(page, f.taskId, f.sections[1].id, 0, false);
  await expect(bar(page, f.taskId)).toHaveClass(/shadow-lg/);
  const openFilters = page.locator("[data-timeline-filter-open]");
  // Keyboard activation is intentional: pointer capture retargets mouse clicks
  // to the bar, but keyboard users can change filters during an active drag.
  await openFilters.focus();
  await openFilters.press("Space");
  const quick = page.locator("[data-timeline-filter-menu]").getByRole("button", { name: "未完了タスク", exact: true });
  await expect(quick).toBeVisible();
  await quick.focus();
  await quick.press("Space");
  await expect(bar(page, f.taskId)).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("[data-timeline-row-drop]")).toHaveCount(0);
  expect(writes).toBe(0);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[0].id, start_on: f.start, due_on: f.due, completed: true });
  await quick.focus();
  await quick.press("Space");
  await expect(groupBar(page, f.taskId, f.sections[0].id)).toBeVisible();
  await expect(bar(page, f.taskId)).not.toHaveClass(/shadow-lg/);
  await quick.press("Escape");
  await expect(page.locator("[data-timeline-filter-menu]")).toHaveCount(0);
  const retried = moveResponse(page, f.taskId);
  await rowDrag(page, f.taskId, f.sections[1].id);
  await retried;
  await expectPinned(page, f.taskId, f.sections[1].id);
  expect(writes).toBe(1);
  expect(errors).toEqual([]);
});

test("dragging a short task's external label moves its section instead of resizing its dates", async ({ page }) => {
  const f = await project(page);
  const start = new Date().toLocaleDateString("en-CA");
  const due = shiftDay(start, 1);
  const { taskId } = await createTask(page, f.projectId, f.sections[0].id, "External label section move", {
    start_on: start, due_on: due,
  });
  await openTimeline(page, f.projectId);
  const label = page.locator(`[data-timeline-bar-label="${taskId}"]`);
  await expect(label).toBeVisible();
  await label.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
  const labelBox = await label.boundingBox();
  const bodyBox = await bar(page, taskId).boundingBox();
  expect(labelBox).not.toBeNull(); expect(bodyBox).not.toBeNull();
  const x = labelBox!.x + labelBox!.width / 2;
  const y = labelBox!.y + labelBox!.height / 2;
  expect(x < bodyBox!.x || x > bodyBox!.x + bodyBox!.width).toBe(true);
  await page.mouse.move(x, y);
  await expect.poll(() => page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest("[data-timeline-bar-label]")?.getAttribute("data-timeline-bar-label"), { x, y })).toBe(String(taskId));
  await page.mouse.down();
  const destination = await page.locator(`[data-timeline-section-row="${f.sections[1].id}"]`).boundingBox();
  expect(destination).not.toBeNull();
  await page.mouse.move(x, destination!.y + 20, { steps: 8 });
  await expect(page.locator("[data-timeline-row-drop]")).toHaveAttribute("data-timeline-row-drop-section", String(f.sections[1].id));
  const saved = moveResponse(page, taskId);
  await page.mouse.up();
  expect((await saved).request().postDataJSON()).toMatchObject({ project_id: f.projectId, section_id: f.sections[1].id, row_index: 0 });
  await expectPinned(page, taskId, f.sections[1].id);
  expect(await readTask(page, f.projectId, taskId)).toMatchObject({ section_id: f.sections[1].id, start_on: start, due_on: due });
  await page.reload();
  await expectPinned(page, taskId, f.sections[1].id);
  expect(await readTask(page, f.projectId, taskId)).toMatchObject({ section_id: f.sections[1].id, start_on: start, due_on: due });
});


for (const dropOnHeader of [false, true]) {
  test(`upward section move follows the visible planning rows${dropOnHeader ? " and accepts the section name" : " including the bottom edge"}`, async ({ page }) => {
    const f = await project(page);
    const planning = f.sections[0];
    const ongoing = f.sections[1];
    const anchor = await createTask(page, f.projectId, planning.id, "Planning row two", { start_on: "2030-01-01", due_on: "2030-01-03" });
    await pin(page, f.projectId, anchor.taskId, 1);
    const moving = await createTask(page, f.projectId, ongoing.id, "List implementation");
    await pin(page, f.projectId, moving.taskId, 0);
    await openTimeline(page, f.projectId);
    const started = await beginDrag(page, moving.taskId);
    const planBox = (await page.locator(`[data-timeline-group="${planning.id}"]`).boundingBox())!;
    const marker = page.locator("[data-timeline-row-drop]");
    const label = page.locator("[data-timeline-drop-label]");
    const sidebar = page.locator(`[data-timeline-section="${planning.id}"]`);
    const sideBox = (await sidebar.boundingBox())!;
    // Approach from below and cross both sides of the boundary repeatedly.
    // The previous hidden 4px append strip previewed a nonexistent planning
    // row three over the ongoing section instead of the row under the pointer.
    for (const offset of [78, 65, 42, 20, 2, 20, 42, 65, 78]) {
      const y = planBox.y + offset;
      await page.mouse.move(started.x, y, { steps: 3 });
      await expect(marker).toHaveAttribute("data-timeline-row-drop-section", String(planning.id));
      await expect(marker).toHaveAttribute("data-timeline-row-drop-index", String(Math.floor(offset / 40)));
      await expect(label).toContainText(planning.name);
      await expect(sidebar).toHaveAttribute("data-timeline-drop-target", "true");
      const preview = (await marker.boundingBox())!;
      expect(preview.y).toBeGreaterThanOrEqual(planBox.y - 1);
      expect(preview.y + preview.height).toBeLessThanOrEqual(planBox.y + planBox.height + 1);
      expect(y).toBeGreaterThanOrEqual(preview.y);
      expect(y).toBeLessThan(preview.y + preview.height);
      const ghost = (await bar(page, moving.taskId).boundingBox())!;
      // The ghost preserves the grab offset; only the destination guide snaps.
      expect(Math.abs(ghost.y + 5 - y)).toBeLessThanOrEqual(1);
    }
    if (dropOnHeader) {
      await page.mouse.move(sideBox.x + sideBox.width / 2, sideBox.y + 20, { steps: 5 });
      await expect(marker).toHaveAttribute("data-timeline-row-drop-index", "0");
    }
    const row = dropOnHeader ? 0 : 1;
    const saved = moveResponse(page, moving.taskId);
    await page.mouse.up();
    expect((await saved).request().postDataJSON()).toMatchObject({ section_id: planning.id, row_index: row });
    await expectPinned(page, moving.taskId, planning.id, row);
    await expect(page.locator('[data-timeline-drop-target="true"]')).toHaveCount(0);
    expect(await readTask(page, f.projectId, moving.taskId)).toMatchObject({
      section_id: planning.id, start_on: moving.start, due_on: moving.due,
    });
    await page.reload();
    await expectPinned(page, moving.taskId, planning.id, row);
  });
}

test("crossing a section border changes both the name highlight and the whole-row preview", async ({ page }) => {
  const f = await fixture(page);
  await openTimeline(page, f.projectId);
  const started = await beginDrag(page, f.taskId);
  const target = page.locator(`[data-timeline-group="${f.sections[1].id}"]`);
  const rect = (await target.boundingBox())!;
  const marker = page.locator("[data-timeline-row-drop]");
  for (const [delta, section] of [[2, f.sections[1]], [-2, f.sections[0]], [2, f.sections[1]]] as const) {
    await page.mouse.move(started.x, rect.y + delta, { steps: 3 });
    await expect(marker).toHaveAttribute("data-timeline-row-drop-section", String(section.id));
    await expect(marker).toHaveAttribute("data-timeline-row-drop-index", "0");
    await expect(page.locator('[data-timeline-drop-target="true"]')).toHaveCount(1);
    await expect(page.locator(`[data-timeline-section="${section.id}"]`)).toHaveAttribute("data-timeline-drop-target", "true");
  }
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(marker).toHaveCount(0);
  await expect(page.locator('[data-timeline-drop-target="true"]')).toHaveCount(0);
  expect((await readTask(page, f.projectId, f.taskId)).section_id).toBe(f.sections[0].id);
});


for (const side of ["above", "below"] as const) {
  test(`overlapping pinned tasks insert ${side} another bar and keep their order after reload`, async ({ page }) => {
    const f = await project(page);
    const anchor = await createTask(page, f.projectId, f.sections[0].id, "Overlapping anchor");
    const moving = await createTask(page, f.projectId, f.sections[0].id, "Moving overlapping task");
    await pin(page, f.projectId, anchor.taskId, side === "above" ? 0 : 1);
    await pin(page, f.projectId, moving.taskId, side === "above" ? 1 : 0);
    await openTimeline(page, f.projectId);
    const started = await beginDrag(page, moving.taskId);
    const anchorBox = (await bar(page, anchor.taskId).boundingBox())!;
    await page.mouse.move(started.x, anchorBox.y + (side === "above" ? 5 : 29), { steps: 8 });
    const marker = page.locator("[data-timeline-row-drop]");
    await expect(marker).toHaveAttribute("data-timeline-row-insert", "true");
    const movingPreview = (await bar(page, moving.taskId).boundingBox())!;
    const anchorPreview = (await bar(page, anchor.taskId).boundingBox())!;
    const dropPreview = (await marker.boundingBox())!;
    expect(Math.abs(movingPreview.y + 5 - anchorBox.y - (side === "above" ? 5 : 29))).toBeLessThanOrEqual(1);
    if (side === "above") expect(dropPreview.y + dropPreview.height).toBeLessThanOrEqual(anchorPreview.y);
    else expect(anchorPreview.y + anchorPreview.height).toBeLessThanOrEqual(dropPreview.y);
    // No chasing the displaced bar: the same pointer position selects the
    // desired side continuously, even after the gap has opened.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(marker).toHaveAttribute("data-timeline-row-insert", "true");
    await page.screenshot({ path: test.info().outputPath(`insertion-${side}.png`) });
    const saved = moveResponse(page, moving.taskId);
    await page.mouse.up();
    const response = await saved;
    expect(response.request().postDataJSON().placements).toHaveLength(1);
    const movingRow = side === "above" ? 0 : 2;
    const anchorRow = 1;
    await expectPinned(page, moving.taskId, f.sections[0].id, movingRow);
    await expectPinned(page, anchor.taskId, f.sections[0].id, anchorRow);
    await page.reload();
    await expectPinned(page, moving.taskId, f.sections[0].id, movingRow);
    await expectPinned(page, anchor.taskId, f.sections[0].id, anchorRow);
    expect(await readTask(page, f.projectId, moving.taskId)).toMatchObject({ start_on: moving.start, due_on: moving.due });
    expect(await readTask(page, f.projectId, anchor.taskId)).toMatchObject({ start_on: anchor.start, due_on: anchor.due });
  });
}

test("legacy same-row pinned overlaps render as distinct bars", async ({ page }) => {
  const f = await fixture(page);
  const peer = await createTask(page, f.projectId, f.sections[0].id, "Legacy overlapping pin");
  await pin(page, f.projectId, f.taskId, 0); await pin(page, f.projectId, peer.taskId, 0);
  await openTimeline(page, f.projectId);
  const a = (await bar(page, f.taskId).boundingBox())!, b = (await bar(page, peer.taskId).boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual(b.y);
});


test("insertion into another section keeps automatic peers below the moved task", async ({ page }) => {
  const f = await project(page);
  const anchor = await createTask(page, f.projectId, f.sections[0].id, "Automatic anchor");
  const moving = await createTask(page, f.projectId, f.sections[1].id, "Cross-section overlapping task");
  await openTimeline(page, f.projectId);
  const started = await beginDrag(page, moving.taskId);
  const a = (await bar(page, anchor.taskId).boundingBox())!;
  await page.mouse.move(started.x, a.y + 5, { steps: 8 });
  await expect(page.locator("[data-timeline-row-drop]")).toHaveAttribute("data-timeline-row-insert", "true");
  const saved = moveResponse(page, moving.taskId);
  await page.mouse.up(); await saved;
  await expectPinned(page, moving.taskId, f.sections[0].id, 0);
  await expectPinned(page, anchor.taskId, f.sections[0].id, 1);
  await page.reload();
  await expectPinned(page, moving.taskId, f.sections[0].id, 0);
  await expectPinned(page, anchor.taskId, f.sections[0].id, 1);
});


for (const otherSection of [false, true]) {
  test(`free drag turns from X to Y ${otherSection ? "across sections" : "within a section"} without locking its ghost`, async ({ page }) => {
    const f = await fixture(page);
    const destination = f.sections[otherSection ? 1 : 0].id;
    const anchor = await createTask(page, f.projectId, destination, "Destination anchor");
    await pin(page, f.projectId, anchor.taskId, 2);
    await openTimeline(page, f.projectId);
    const started = await beginDrag(page, f.taskId);
    const original = (await started.target.boundingBox())!;
    await page.mouse.move(started.x + 70, started.y, { steps: 5 });
    await expect(started.target).toHaveClass(/shadow-lg/);
    const header = (await page.locator(`[data-timeline-section-row="${destination}"]`).boundingBox())!;
    const y = header.y + 40 + 27;
    await page.mouse.move(started.x + 70, y, { steps: 7 });
    const guide = page.locator("[data-timeline-row-drop]");
    await expect(guide).toHaveAttribute("data-timeline-row-drop-section", String(destination));
    await expect(guide).toHaveAttribute("data-timeline-row-drop-index", "1");
    // Exercise direction changes after activation, with sub-row pointer motion.
    for (const offset of [70, 29, -35, 50]) {
      await page.mouse.move(started.x + offset, y + 3, { steps: 3 });
      const ghost = (await started.target.boundingBox())!;
      expect(Math.abs(ghost.x - original.x - offset)).toBeLessThanOrEqual(1);
      expect(Math.abs(ghost.y + 5 - y - 3)).toBeLessThanOrEqual(1);
      await expect(guide).toHaveAttribute("data-timeline-row-drop-index", "1");
    }
    await expect(page.locator(`[data-timeline-drag-origin="${f.taskId}"]`)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`free-drag-${otherSection ? "cross-section" : "same-section"}.png`) });
    const canvas = page.locator("[data-timeline-canvas]");
    const days = Math.round(50 / ((await canvas.boundingBox())!.width / Number(await canvas.getAttribute("data-timeline-span"))));
    const saved = moveResponse(page, f.taskId);
    await page.mouse.up();
    expect((await saved).request().postDataJSON().date_delta).toBe(days);
    await expectPinned(page, f.taskId, destination, 1);
    await page.reload();
    await expectPinned(page, f.taskId, destination, 1);
    expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: destination, start_on: shiftDay(f.start, days), due_on: shiftDay(f.due, days) });
  });
}

test("free drag turns from Y to X and returns to the source row to change dates", async ({ page }) => {
  const f = await fixture(page);
  await openTimeline(page, f.projectId);
  const started = await beginDrag(page, f.taskId);
  const original = (await started.target.boundingBox())!;
  const destination = (await page.locator(`[data-timeline-section-row="${f.sections[1].id}"]`).boundingBox())!;
  await page.mouse.move(started.x, destination.y + 17, { steps: 5 });
  const guide = page.locator("[data-timeline-row-drop]");
  await expect(guide).toHaveAttribute("data-timeline-row-drop-section", String(f.sections[1].id));
  await page.mouse.move(started.x + 48, destination.y + 17, { steps: 4 });
  expect(Math.abs((await started.target.boundingBox())!.x - original.x - 48)).toBeLessThanOrEqual(1);
  await page.mouse.move(started.x + 48, started.y, { steps: 5 });
  await expect(guide).toHaveCount(0);
  expect(Math.abs((await started.target.boundingBox())!.y - original.y)).toBeLessThanOrEqual(1);
  const saved = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/tasks/${f.taskId}` && r.request().method() === "PATCH" && r.status() === 200);
  await page.mouse.up(); await saved;
  await page.reload();
  const task = await readTask(page, f.projectId, f.taskId);
  expect(task.section_id).toBe(f.sections[0].id);
  expect(task.start_on).not.toBe(f.start);
  const days = Math.round((Date.parse(task.start_on) - Date.parse(f.start)) / 86400000);
  expect(task.due_on).toBe(shiftDay(f.due, days));
});

test("free ghost follows both scroll axes after an X-first drag and Escape writes nothing", async ({ page }) => {
  const f = await fixture(page);
  const tail = await createTask(page, f.projectId, f.sections[2].id, "Tall scroll destination");
  await pin(page, f.projectId, tail.taskId, 30);
  await openTimeline(page, f.projectId);
  let writes = 0;
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith(`/api/tasks/${f.taskId}`) && ["PUT", "PATCH"].includes(r.method())) writes++; });
  const started = await beginDrag(page, f.taskId);
  const original = (await started.target.boundingBox())!;
  const x = started.x + 60, y = started.y + 62;
  await page.mouse.move(x, started.y, { steps: 3 });
  await page.mouse.move(x, y, { steps: 3 });
  await page.locator(".timeline-scroll").evaluate(e => { e.scrollLeft += 64; });
  await page.locator("main").evaluate(e => { e.scrollTop += 90; });
  await expect.poll(async () => {
    const ghost = (await started.target.boundingBox())!;
    return Math.max(Math.abs(ghost.x - original.x - 60), Math.abs(ghost.y + 5 - y));
  }).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.locator("[data-timeline-drag-origin]")).toHaveCount(0);
  await expect(page.locator("[data-timeline-row-drop]")).toHaveCount(0);
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ section_id: f.sections[0].id, start_on: f.start, due_on: f.due });
  expect(writes).toBe(0);
});


for (const crossSection of [false, true]) {
  test(`diagonal drop across a bar saves November 1 instead of November 9 ${crossSection ? "across sections" : "in the same section"}`, async ({ page }) => {
    const f = await project(page);
    const anchor = await createTask(page, f.projectId, f.sections[0].id, "November 1 anchor", { start_on: "2030-11-01", due_on: "2030-11-05" });
    const moving = await createTask(page, f.projectId, f.sections[crossSection ? 1 : 0].id, "November 9 moving task", { start_on: "2030-11-09", due_on: "2030-11-13" });
    await pin(page, f.projectId, anchor.taskId, 0);
    await pin(page, f.projectId, moving.taskId, crossSection ? 0 : 1);
    await openTimeline(page, f.projectId);
    const started = await beginDrag(page, moving.taskId);
    const original = (await started.target.boundingBox())!;
    const anchorBox = (await bar(page, anchor.taskId).boundingBox())!;
    const canvas = page.locator("[data-timeline-canvas]");
    const dayWidth = (await canvas.boundingBox())!.width / Number(await canvas.getAttribute("data-timeline-span"));
    const x = started.x - 8 * dayWidth;
    // Begin horizontally, then pass over a previously non-overlapping bar.
    await page.mouse.move(x, started.y, { steps: 6 });
    await page.mouse.move(x, anchorBox.y + 5, { steps: 6 });
    const marker = page.locator("[data-timeline-row-drop]");
    await expect(marker).toHaveAttribute("data-timeline-row-insert", "true");
    await expect(marker).toHaveAttribute("data-timeline-row-drop-index", "0");
    const ghost = (await started.target.boundingBox())!;
    expect(Math.abs(ghost.x - original.x + 8 * dayWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(ghost.y + 5 - anchorBox.y - 5)).toBeLessThanOrEqual(1);
    const saved = moveResponse(page, moving.taskId);
    await page.mouse.up();
    expect((await saved).request().postDataJSON()).toMatchObject({ section_id: f.sections[0].id, row_index: 0, date_delta: -8, placements: [{ task_id: anchor.taskId, row_index: 1 }] });
    await expectPinned(page, moving.taskId, f.sections[0].id, 0);
    await expectPinned(page, anchor.taskId, f.sections[0].id, 1);
    await page.reload();
    await expectPinned(page, moving.taskId, f.sections[0].id, 0);
    expect(await readTask(page, f.projectId, moving.taskId)).toMatchObject({ start_on: "2030-11-01", due_on: "2030-11-05", section_id: f.sections[0].id });
    expect(await readTask(page, f.projectId, anchor.taskId)).toMatchObject({ start_on: "2030-11-01", due_on: "2030-11-05" });
    await page.screenshot({ path: test.info().outputPath(`diagonal-dates-${crossSection ? "cross-section" : "same-section"}-saved.png`) });
  });
}

test("diagonal milestone movement changes its due date without filling its missing start date", async ({ page }) => {
  const f = await fixture(page, { start_on: null, due_on: "2030-11-09", is_milestone: true });
  await openTimeline(page, f.projectId);
  const started = await beginDrag(page, f.taskId);
  const header = (await page.locator(`[data-timeline-section-row="${f.sections[1].id}"]`).boundingBox())!;
  const canvas = page.locator("[data-timeline-canvas]");
  const dayWidth = (await canvas.boundingBox())!.width / Number(await canvas.getAttribute("data-timeline-span"));
  await page.mouse.move(started.x - 8 * dayWidth, started.y, { steps: 5 });
  await page.mouse.move(started.x - 8 * dayWidth, header.y + 20, { steps: 5 });
  const saved = moveResponse(page, f.taskId);
  await page.mouse.up();
  expect((await saved).request().postDataJSON().date_delta).toBe(-8);
  await expectPinned(page, f.taskId, f.sections[1].id);
  await page.reload();
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ start_on: null, due_on: "2030-11-01", section_id: f.sections[1].id });
  await expect(bar(page, f.taskId).locator("[data-task-milestone]")).toBeVisible();
});

test("a diagonal drop includes horizontal scroll in its saved date offset", async ({ page }) => {
  const f = await fixture(page);
  await openTimeline(page, f.projectId);
  const started = await beginDrag(page, f.taskId);
  const header = (await page.locator(`[data-timeline-section-row="${f.sections[1].id}"]`).boundingBox())!;
  const canvas = page.locator("[data-timeline-canvas]");
  const dayWidth = (await canvas.boundingBox())!.width / Number(await canvas.getAttribute("data-timeline-span"));
  const scroller = page.locator(".timeline-scroll");
  const before = await scroller.evaluate(e => e.scrollLeft);
  await page.mouse.move(started.x + dayWidth, header.y + 20, { steps: 5 });
  await scroller.evaluate((e, dx) => { e.scrollLeft += dx; }, 2 * dayWidth);
  const after = await scroller.evaluate(e => e.scrollLeft);
  expect(after).toBeGreaterThan(before);
  const days = Math.round((dayWidth + after - before) / dayWidth);
  const saved = moveResponse(page, f.taskId);
  await page.mouse.up();
  expect((await saved).request().postDataJSON().date_delta).toBe(days);
  await expectPinned(page, f.taskId, f.sections[1].id);
  await page.reload();
  expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ start_on: shiftDay(f.start, days), due_on: shiftDay(f.due, days), section_id: f.sections[1].id });
});

for (const status of [409, 503]) {
  test(`a diagonal save ${status} restores both date and section and allows a retry`, async ({ page }) => {
    const f = await fixture(page);
    await openTimeline(page, f.projectId);
    const route = `**/api/tasks/${f.taskId}/timeline-row`;
    await page.route(route, r => r.fulfill({ status, contentType: "application/json", body: '{"error":"injected diagonal failure"}' }));
    const drop = async (expected: number) => {
      const started = await beginDrag(page, f.taskId);
      const header = (await page.locator(`[data-timeline-section-row="${f.sections[1].id}"]`).boundingBox())!;
      const canvas = page.locator("[data-timeline-canvas]");
      const dayWidth = (await canvas.boundingBox())!.width / Number(await canvas.getAttribute("data-timeline-span"));
      await page.mouse.move(started.x + 2 * dayWidth, started.y, { steps: 4 });
      await page.mouse.move(started.x + 2 * dayWidth, header.y + 20, { steps: 4 });
      const saved = moveResponse(page, f.taskId, expected);
      await page.mouse.up();
      expect((await saved).request().postDataJSON().date_delta).toBe(2);
      await expect(page.locator("[data-timeline-row-drop]")).toHaveCount(0);
    };
    await drop(status);
    await expect(groupBar(page, f.taskId, f.sections[0].id)).not.toHaveClass(/shadow-lg/);
    expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ start_on: f.start, due_on: f.due, section_id: f.sections[0].id });
    await page.unroute(route);
    await drop(200);
    await expectPinned(page, f.taskId, f.sections[1].id);
    await page.reload();
    expect(await readTask(page, f.projectId, f.taskId)).toMatchObject({ start_on: shiftDay(f.start, 2), due_on: shiftDay(f.due, 2), section_id: f.sections[1].id });
  });
}


for (const legacyPins of [true, false]) {
  test(`TR02 keyboard insertion uses displayed lanes with ${legacyPins ? "overlapping saved pins" : "automatic peers"} and persists focus/order`, async ({page})=>{
    const f=await fixture(page);
    const moving=await createTask(page,f.projectId,f.sections[0].id,'Keyboard moving task');
    if(legacyPins) {await pin(page,f.projectId,f.taskId,0);await pin(page,f.projectId,moving.taskId,0);}
    await openTimeline(page,f.projectId);
    await expect(bar(page,moving.taskId)).toHaveAttribute('data-timeline-lane','1');
    await bar(page,moving.taskId).focus();
    const steps=[{key:'Alt+ArrowUp',row:0,peer:1},{key:'Alt+ArrowDown',row:2,peer:1},{key:'Alt+ArrowUp',row:1,peer:2}];
    for(const step of steps) {
      const saved=moveResponse(page,moving.taskId);
      await bar(page,moving.taskId).press(step.key);
      const response=await saved,body=response.request().postDataJSON();
      expect(body).toMatchObject({project_id:f.projectId,section_id:f.sections[0].id,row_index:step.row,expected_section_id:f.sections[0].id});
      expect(body.expected_task_updated_at).toBeTruthy();
      expect(body.placements).toEqual([expect.objectContaining({task_id:f.taskId,row_index:step.peer})]);
      expect(body).not.toHaveProperty('date_delta');
      await expectPinned(page,moving.taskId,f.sections[0].id,step.row);
      await expectPinned(page,f.taskId,f.sections[0].id,step.peer);
      await expect(bar(page,moving.taskId)).toBeFocused();
    }
    await page.reload();
    await expectPinned(page,moving.taskId,f.sections[0].id,1);
    await expectPinned(page,f.taskId,f.sections[0].id,2);
    expect(await readTask(page,f.projectId,moving.taskId)).toMatchObject({start_on:moving.start,due_on:moving.due,section_id:f.sections[0].id});
    expect(await readTask(page,f.projectId,f.taskId)).toMatchObject({start_on:f.start,due_on:f.due,section_id:f.sections[0].id});
  });
}

for(const status of [409,503]) {
  test(`TR02 keyboard insertion recovers from ${status} and retries without partial row/date changes`,async({page})=>{
    const f=await fixture(page),moving=await createTask(page,f.projectId,f.sections[0].id,'Keyboard conflict task');
    await pin(page,f.projectId,f.taskId,0);await pin(page,f.projectId,moving.taskId,0);
    await openTimeline(page,f.projectId);await bar(page,moving.taskId).focus();
    await page.route(`**/api/tasks/${moving.taskId}/timeline-row`,async route=>{
      if(status===409) {
        // Change a peer after the insertion's CAS stamps have been captured.
        const changed=await page.request.patch(`/api/tasks/${f.taskId}`,{data:{name:'Peer edited concurrently'}});
        expect(changed.status()).toBe(200);
        await route.continue();
      } else await route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:'temporary failure'})});
    },{times:1});
    const failed=moveResponse(page,moving.taskId,status);
    await bar(page,moving.taskId).press('Alt+ArrowUp');await failed;
    await expect(page.getByRole('status').filter({hasText:status===409?'他のユーザーが先に更新しました':'タスクの移動に失敗しました'})).toBeVisible();
    await expect(bar(page,moving.taskId)).toHaveAttribute('data-timeline-lane','1');
    await expect(bar(page,f.taskId)).toHaveAttribute('data-timeline-lane','0');
    if(status===409) await expect(bar(page,f.taskId)).toHaveAttribute('aria-label',/Peer edited concurrently/);
    const saved=moveResponse(page,moving.taskId);
    await bar(page,moving.taskId).press('Alt+ArrowUp');await saved;
    await expectPinned(page,moving.taskId,f.sections[0].id,0);
    await expectPinned(page,f.taskId,f.sections[0].id,1);
    await expect(bar(page,moving.taskId)).toBeFocused();
    expect(await readTask(page,f.projectId,moving.taskId)).toMatchObject({start_on:moving.start,due_on:moving.due});
  });
}
