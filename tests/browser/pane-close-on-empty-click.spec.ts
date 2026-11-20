import { expect, test, type Locator, type Page } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const fixtures = new WeakMap<Page, number>();

type Section = { id: number; name: string };
type SavedTask = { id: number; name: string; section_id: number | null };

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});

test.afterEach(async ({ page }) => {
  const projectId = fixtures.get(page);
  if (projectId === undefined) return;
  await page.goto("about:blank");
  expect((await page.request.delete(`/api/projects/${projectId}`)).ok()).toBeTruthy();
});

async function sections(page: Page, projectId: number): Promise<Section[]> {
  const response = await page.request.get(`/api/lookup?project_id=${projectId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Section[];
}

async function savedTasks(page: Page, projectId: number): Promise<SavedTask[]> {
  const response = await page.request.get(`/api/projects/${projectId}/export?format=json`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { tasks: SavedTask[] }).tasks;
}

async function fixture(page: Page) {
  const response = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `空きクリック ${test.info().testId} ${Date.now()}` },
  });
  expect(response.status()).toBe(201);
  const { id: projectId } = (await response.json()) as { id: number };
  fixtures.set(page, projectId);

  const list = await sections(page, projectId);
  while (list.length < 2) {
    const created = await page.request.post("/api/sections", {
      data: { project_id: projectId, name: `空きクリック用セクション ${list.length + 1}` },
    });
    expect(created.status()).toBe(201);
    list.push((await created.json()) as Section);
  }

  const names = ["空きクリック タスクA", "空きクリック タスクB"];
  for (const [index, name] of names.entries()) {
    const task = await page.request.post("/api/tasks", {
      data: { project_id: projectId, section_id: list[index].id, name },
    });
    expect(task.status()).toBe(201);
  }
  const tasks = await savedTasks(page, projectId);
  expect(tasks).toHaveLength(2);
  return { projectId, sections: list, a: tasks[0], b: tasks[1] };
}

/** Wait for the list because-board handlers to attach without writing data. */
async function waitForListHydration(page: Page) {
  const trigger = page.locator("[data-list-filter-open]");
  await expect(async () => {
    await trigger.dispatchEvent("click");
    await expect(page.locator("[data-list-filter-menu]")).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.locator("[data-list-view] div.fixed.inset-0.z-30").first().dispatchEvent("click");
  await expect(page.locator("[data-list-filter-menu]")).toHaveCount(0);
}

async function waitForBoardHydration(page: Page) {
  const trigger = page.locator("[data-board-filter]");
  await expect(async () => {
    await trigger.dispatchEvent("click");
    await expect(page.locator("[data-board-filter-menu]")).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.locator("[data-board-view] div.fixed.inset-0.z-30").first().dispatchEvent("click");
  await expect(page.locator("[data-board-filter-menu]")).toHaveCount(0);
}

async function openPane(page: Page, projectId: number, view: "list" | "board", taskId: number) {
  await page.goto(`/projects/${projectId}?view=${view}&task=${taskId}`);
  await expect(page.locator(`[data-${view}-view]`)).toBeVisible();
  if (view === "list") {
    await waitForListHydration(page);
    // The list persists its view state by adding list_state=1. Wait for that
    // client navigation to settle so the click listener is not lost midway.
    await page.waitForURL((url) => url.searchParams.get("list_state") === "1");
  } else {
    await waitForBoardHydration(page);
  }
  await page.waitForTimeout(250);
  const pane = page.locator("[data-task-pane]");
  await expect(pane).toBeVisible();
  return pane;
}

async function expectPaneClosed(page: Page) {
  await expect(page.locator("[data-task-pane]")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("task")).toBeNull();
}

async function expectPaneOn(page: Page, taskId: number) {
  await expect(page.locator("[data-task-pane]")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("task")).toBe(String(taskId));
}

function sectionBlock(page: Page, sectionId: number): Locator {
  return page.locator(`[data-list-section-block="${sectionId}"]`);
}

/** Right-hand empty point in an element, clamped to the visible list width. */
function emptyPoint(box: { x: number; y: number; width: number; height: number }, rightInset = 24) {
  const paneLeft = 840; // 1600px viewport: pane is 760px wide.
  return {
    x: Math.min(box.x + box.width - rightInset, paneLeft - 20),
    y: box.y + box.height / 2,
  };
}

test("list: section, add-row, row-end, toolbar and summary empty areas close the pane", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const f = await fixture(page);
  await openPane(page, f.projectId, "list", f.a.id);

  const reopen = async () => {
    await openPane(page, f.projectId, "list", f.a.id);
  };

  // (a) Right of the section name in its heading row.
  const header = sectionBlock(page, f.a.section_id!).locator("[data-list-section-header]").first();
  const headerPoint = emptyPoint((await header.boundingBox())!);
  await page.mouse.click(headerPoint.x, headerPoint.y);
  await expectPaneClosed(page);

  // (b) Right of the section's "タスクを追加" row.
  await reopen();
  const addRow = sectionBlock(page, f.a.section_id!).locator('[data-list-footer-row="ghost"]').first();
  const addPoint = emptyPoint((await addRow.boundingBox())!);
  await page.mouse.click(addPoint.x, addPoint.y);
  await expectPaneClosed(page);

  // (c) Right of the last data column in a task row. Scroll to the far right
  // so the row's trailing empty cell is visible beside the pane.
  await reopen();
  const scroller = page.locator("[data-list-view] [data-page-scroll]");
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const row = page.locator(`[data-list-row="${f.a.id}"]`);
  await row.scrollIntoViewIfNeeded();
  const rowBox = (await row.boundingBox())!;
  const lastCellRight = await row.evaluate((element) => {
    const cells = [...element.children].filter(
      (child) => !child.hasAttribute("data-list-row-delete"),
    );
    return Math.max(...cells.map((cell) => cell.getBoundingClientRect().right));
  });
  expect(lastCellRight + 8).toBeLessThan(840);
  await page.mouse.click(lastCellRight + 8, rowBox.y + rowBox.height / 2);
  await expectPaneClosed(page);

  // (d) Empty space in the view toolbar between add and filters.
  await reopen();
  const addButton = (await page.locator("[data-list-add]").boundingBox())!;
  const filterButton = (await page.locator("[data-list-filter-open]").boundingBox())!;
  await page.mouse.click(
    (addButton.x + addButton.width + filterButton.x) / 2,
    addButton.y + addButton.height / 2,
  );
  await expectPaneClosed(page);

  // (e) Right of the task counts line.
  await reopen();
  const summary = (await page.locator("[data-list-summary]").boundingBox())!;
  const summaryPoint = emptyPoint(summary);
  await page.mouse.click(summaryPoint.x, summaryPoint.y);
  await expectPaneClosed(page);

  // (f) Empty trailing space in the column header row.
  await reopen();
  const listScroller = page.locator("[data-list-view] [data-page-scroll]");
  await listScroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const headerRow = page.locator("[data-list-column-header]");
  const headerRowBox = (await headerRow.boundingBox())!;
  const addFieldBox = (await page.locator("[data-field-add-button]").boundingBox())!;
  await page.mouse.click(addFieldBox.x - 4, headerRowBox.y + headerRowBox.height / 2);
  await expectPaneClosed(page);
});

test("list: rows, cells, menus and drags do not close the pane", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const f = await fixture(page);
  const pane = await openPane(page, f.projectId, "list", f.a.id);

  // Another row switches tasks instead of closing.
  const rowB = page.locator(`[data-list-row="${f.b.id}"]`);
  await rowB.scrollIntoViewIfNeeded();
  const rowBBox = (await rowB.boundingBox())!;
  await page.mouse.click(rowBBox.x + 14, rowBBox.y + rowBBox.height / 2);
  await expectPaneOn(page, f.b.id);

  const rowA = page.locator(`[data-list-row="${f.a.id}"]`);
  await rowA.scrollIntoViewIfNeeded();

  // Assignee cell opens its picker and leaves the pane open.
  await rowA.locator("> *").nth(2).click();
  await expect(page.locator("[data-assignee-menu]")).toBeVisible();
  await expect(pane).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-assignee-menu]")).toHaveCount(0);

  // Due cell opens its picker and leaves the pane open. Pick a day so the
  // calendar owns focus, then Escape closes only the picker.
  await rowA.locator("> *").nth(3).click();
  await expect(page.locator("[data-due-menu]")).toBeVisible();
  await expect(pane).toBeVisible();
  await page.locator("[data-due-day]").nth(15).click();
  await expect(page.locator("[data-due-menu]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-due-menu]")).toHaveCount(0);
  await expect(pane).toBeVisible();

  // A column resize handle keeps its own press behavior.
  await page.locator('[data-list-header="due"] [data-column-resize-handle]').click();
  await expect(pane).toBeVisible();
  await expectPaneOn(page, f.b.id);

  // An open section menu is dismissed first; the pane stays.
  const section = sectionBlock(page, f.a.section_id!);
  await section.hover();
  await section.locator("[data-section-menu-button]").first().click();
  await expect(page.locator("[data-section-menu]")).toBeVisible();
  const summary = (await page.locator("[data-list-summary]").boundingBox())!;
  const summaryPoint = emptyPoint(summary);
  await page.mouse.click(summaryPoint.x, summaryPoint.y);
  await expect(page.locator("[data-section-menu]")).toHaveCount(0);
  await expect(pane).toBeVisible();
  await expectPaneOn(page, f.b.id);

  // A press-drag-release on empty space is not a click.
  await page.mouse.move(summaryPoint.x - 40, summaryPoint.y);
  await page.mouse.down();
  await page.mouse.move(summaryPoint.x + 20, summaryPoint.y, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(pane).toBeVisible();
  await expectPaneOn(page, f.b.id);

  // Modified clicks belong to the existing selection shortcuts.
  await page.keyboard.down("Shift");
  await page.mouse.click(summaryPoint.x - 20, summaryPoint.y);
  await page.keyboard.up("Shift");
  await expect(pane).toBeVisible();
  await expectPaneOn(page, f.b.id);
});

test("list: an untouched draft is cancelled and the pane closes", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const f = await fixture(page);
  const pane = await openPane(page, f.projectId, "list", f.a.id);
  const before = await savedTasks(page, f.projectId);

  await page.locator("[data-list-add]").click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  await expect(page.getByRole("textbox", { name: "新しいタスク名", exact: true })).toBeFocused();

  const summary = (await page.locator("[data-list-summary]").boundingBox())!;
  const summaryPoint = emptyPoint(summary);
  await page.mouse.click(summaryPoint.x, summaryPoint.y);

  await expect(page.locator("[data-task-pane]")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("task")).toBeNull();
  await expect.poll(async () => (await savedTasks(page, f.projectId)).length).toBe(before.length);
});

test("list: a named draft still moves the pane to the created task", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const f = await fixture(page);
  const pane = await openPane(page, f.projectId, "list", f.a.id);

  await page.locator("[data-list-add]").click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  const name = "空きクリックから作るタスク";
  await page.getByRole("textbox", { name: "新しいタスク名", exact: true }).fill(name);

  const summary = (await page.locator("[data-list-summary]").boundingBox())!;
  const summaryPoint = emptyPoint(summary);
  await page.mouse.click(summaryPoint.x, summaryPoint.y);

  await expect.poll(() => new URL(page.url()).searchParams.get("task")).not.toBe(String(f.a.id));
  const createdId = Number(new URL(page.url()).searchParams.get("task"));
  expect(Number.isInteger(createdId)).toBe(true);
  await expect(pane).toBeVisible();
  await expect(pane).not.toHaveAttribute("data-task-pane-draft", "true");
  await expect(pane.getByRole("textbox", { name: "タスク名", exact: true })).toHaveValue(name);
  await expect.poll(async () =>
    (await savedTasks(page, f.projectId)).find((task) => task.id === createdId)?.name,
  ).toBe(name);
});

test("list: holding the press until a named draft is created keeps the created task open", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const f = await fixture(page);
  const pane = await openPane(page, f.projectId, "list", f.a.id);

  await page.locator("[data-list-add]").click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  const name = "長押し中に作成されるタスク";
  await page.getByRole("textbox", { name: "新しいタスク名", exact: true }).fill(name);

  // Press on empty space and hold until the commit and the pane handoff have
  // both finished, then release. The release must not close the new task.
  const summaryPoint = emptyPoint((await page.locator("[data-list-summary]").boundingBox())!);
  await page.mouse.move(summaryPoint.x, summaryPoint.y);
  await page.mouse.down();
  await expect.poll(() => new URL(page.url()).searchParams.get("task")).not.toBe(String(f.a.id));
  await expect(pane).not.toHaveAttribute("data-task-pane-draft", "true");
  const createdId = new URL(page.url()).searchParams.get("task");
  await page.mouse.up();

  await page.waitForTimeout(300);
  await expect(page.locator("[data-task-pane]")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("task")).toBe(createdId);
  await expect(pane.getByRole("textbox", { name: "タスク名", exact: true })).toHaveValue(name);
});

test("list: a cancelled drag on the draft name does not disable empty-space closing", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const f = await fixture(page);
  const pane = await openPane(page, f.projectId, "list", f.a.id);

  await page.locator("[data-list-add]").click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  const input = page.getByRole("textbox", { name: "新しいタスク名", exact: true });
  // The draft name cancels dragstart (no dragend follows). Dispatch the same
  // native event a text drag would start with and confirm it was cancelled.
  const cancelled = await input.evaluate((element) => {
    const event = new DragEvent("dragstart", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cancelled).toBe(true);
  await page.waitForTimeout(50);

  // Discard the untouched draft; the pane returns to task A.
  await input.press("Escape");
  await expectPaneOn(page, f.a.id);

  const summaryPoint = emptyPoint((await page.locator("[data-list-summary]").boundingBox())!);
  await page.mouse.click(summaryPoint.x, summaryPoint.y);
  await expectPaneClosed(page);
});

test("board: empty column space, gaps and toolbar close; cards and add keep the pane", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const f = await fixture(page);
  await openPane(page, f.projectId, "board", f.a.id);
  const reopen = async () => {
    await openPane(page, f.projectId, "board", f.a.id);
  };

  const columnA = page.locator(`[data-board-column="s${f.a.section_id}"]`);
  const columnBox = (await columnA.boundingBox())!;
  // (a) Empty space below the column's cards.
  await page.mouse.click(columnBox.x + columnBox.width / 2, columnBox.y + columnBox.height + 12);
  await expectPaneClosed(page);

  // (b) Gap between two columns.
  await reopen();
  const gapColumn = page.locator(`[data-board-column="s${f.a.section_id}"]`);
  const gapBox = (await gapColumn.boundingBox())!;
  await page.mouse.click(gapBox.x + gapBox.width + 8, gapBox.y + 80);
  await expectPaneClosed(page);

  // (c) Empty space in the board toolbar.
  await reopen();
  const addButton = (await page.locator("[data-board-add]").boundingBox())!;
  const filterButton = (await page.locator("[data-board-filter]").boundingBox())!;
  await page.mouse.click(
    (addButton.x + addButton.width + filterButton.x) / 2,
    addButton.y + addButton.height / 2,
  );
  await expectPaneClosed(page);

  // Another card switches tasks.
  await reopen();
  const cardB = page.locator(`[data-board-card="${f.b.id}"]`);
  await cardB.click();
  await expectPaneOn(page, f.b.id);

  // The column's add-task button opens a draft without closing the pane.
  const columnB = page.locator(`[data-board-column="s${f.b.section_id}"]`);
  await columnB.locator("[data-add-task-open]").click();
  await expect(page.locator("[data-task-pane]")).toBeVisible();
  await expect(page.locator("[data-task-pane]")).toHaveAttribute("data-task-pane-draft", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("task")).toBe(String(f.b.id));
});

test("narrow viewport: the full-screen pane is untouched", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const f = await fixture(page);
  await openPane(page, f.projectId, "list", f.a.id);
  await page.mouse.click(4, 700);
  await expectPaneOn(page, f.a.id);
});
