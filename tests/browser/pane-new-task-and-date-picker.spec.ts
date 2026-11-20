import { expect, test, type Page } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const projects = new WeakMap<Page, number>();
const CLOCK = new Date("2026-11-17T10:00:00+09:00");

type SavedTask = {
  id: number;
  name: string;
  section_id: number | null;
  start_on: string | null;
  due_on: string | null;
};

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});

test.afterEach(async ({ page }) => {
  const projectId = projects.get(page);
  if (!projectId) return;
  await page.goto("about:blank");
  expect((await page.request.delete(`/api/projects/${projectId}`)).ok()).toBeTruthy();
});

async function savedTasks(page: Page, projectId: number): Promise<SavedTask[]> {
  const response = await page.request.get(`/api/projects/${projectId}/export?format=json`);
  expect(response.status()).toBe(200);
  return (await response.json() as { tasks: SavedTask[] }).tasks;
}

async function fixture(page: Page, names = ["既存タスクA"]) {
  const response = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `ペインと期日 ${test.info().testId} ${Date.now()}` },
  });
  expect(response.status()).toBe(201);
  const { id: projectId } = await response.json() as { id: number };
  projects.set(page, projectId);
  const sections = await (await page.request.get(`/api/lookup?project_id=${projectId}`)).json() as { id: number; name: string }[];
  expect(sections.length).toBeGreaterThan(0);
  for (const [index, name] of names.entries()) {
    const task = await page.request.post("/api/tasks", {
      data: { project_id: projectId, section_id: sections[index % sections.length].id, name },
    });
    expect(task.status()).toBe(201);
  }
  return { projectId, sectionId: sections[0].id, tasks: await savedTasks(page, projectId) };
}

/** Wait for the list toolbar's React handlers without mutating tasks. */
async function waitForListHydration(page: Page) {
  const filter = page.locator("[data-list-filter-open]");
  await expect(async () => {
    await filter.dispatchEvent("click");
    await expect(page.locator("[data-list-filter-menu]")).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.locator("[data-list-view] div.fixed.inset-0.z-30").first().dispatchEvent("click");
  await expect(page.locator("[data-list-filter-menu]")).toHaveCount(0);
}

async function openPane(page: Page, projectId: number, taskId: number) {
  await page.goto(`/projects/${projectId}?view=list&task=${taskId}`);
  const pane = page.locator("[data-task-pane]");
  await expect(pane).toBeVisible();
  await waitForListHydration(page);
  return pane;
}

const paneName = (pane: ReturnType<Page["locator"]>) =>
  pane.getByRole("textbox", { name: "タスク名", exact: true });
const newRowName = (page: Page) =>
  page.getByRole("textbox", { name: "新しいタスク名", exact: true });

test("toolbar add replaces an open task pane with the draft and then its created task", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page);
  const existing = f.tasks[0];
  const pane = await openPane(page, f.projectId, existing.id);
  await expect(paneName(pane)).toHaveValue(existing.name);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/tasks") posts += 1;
  });

  await page.locator("[data-list-add]").click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  await expect(paneName(pane)).toHaveValue("");
  await expect(paneName(pane)).toHaveAttribute("placeholder", "タスク名を入力");
  await expect(paneName(pane)).not.toBeFocused();
  await expect(pane.locator("[data-draft-pane-fields]")).toHaveAttribute("disabled", "");
  await expect(pane.locator("[data-draft-pane-fields] button").first()).toBeDisabled();
  await expect(pane.getByText("タスク名を確定すると、担当者・期日・説明を編集できます。")).toBeVisible();

  const row = newRowName(page);
  await expect(row).toBeFocused();
  await row.fill("新しい空タスク");
  await expect(paneName(pane)).toHaveValue("新しい空タスク");

  // Either name field edits the same draft, and moving between them must not
  // commit the row early.
  await paneName(pane).click();
  await expect(paneName(pane)).toBeFocused();
  await paneName(pane).fill("ペインで仕上げたタスク");
  await expect(row).toHaveValue("ペインで仕上げたタスク");
  expect(posts).toBe(0);

  const posted = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/tasks" &&
    response.request().method() === "POST" && response.status() === 201);
  await paneName(pane).press("Enter");
  const { id } = await (await posted).json() as { id: number };
  await page.waitForURL((url) => url.searchParams.get("task") === String(id));

  await expect(pane.getByRole("textbox", { name: "タスク名", exact: true })).toHaveValue("ペインで仕上げたタスク");
  await expect(pane).not.toHaveAttribute("data-task-pane-draft", "true");
  await expect(pane.locator("[data-draft-pane-fields]")).toHaveCount(0);
  await expect(pane.locator("[data-task-fields]")).not.toHaveAttribute("disabled", "");
  await expect.poll(async () => (await savedTasks(page, f.projectId)).find((task) => task.id === id)?.name)
    .toBe("ペインで仕上げたタスク");
});

test("an empty draft cancelled with Escape returns to the task that was open without a POST", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page);
  const existing = f.tasks[0];
  const pane = await openPane(page, f.projectId, existing.id);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/tasks") posts += 1;
  });

  await page.locator("[data-list-add]").click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  const row = newRowName(page);
  await expect(row).toBeFocused();
  await row.press("Escape");

  await expect(pane).not.toHaveAttribute("data-task-pane-draft", "true");
  await expect(paneName(pane)).toHaveValue(existing.name);
  expect(new URL(page.url()).searchParams.get("task")).toBe(String(existing.id));

  // Blurring an empty draft on a non-focusable pane area cancels it too.
  await page.locator("[data-list-add]").click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  await pane.getByText("タスク名を確定すると、担当者・期日・説明を編集できます。").click();
  await expect(pane).not.toHaveAttribute("data-task-pane-draft", "true");
  await expect(paneName(pane)).toHaveValue(existing.name);

  expect(posts).toBe(0);
  await expect.poll(async () => (await savedTasks(page, f.projectId)).length).toBe(1);
});

test("section header and section add-row drafts also take over the open pane", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page);
  const existing = f.tasks[0];
  const pane = await openPane(page, f.projectId, existing.id);
  const section = page.locator(`[data-list-section-block="${f.sectionId}"]`);

  await section.hover();
  await section.locator("[data-section-add-task]").click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  await expect(newRowName(page)).toBeFocused();
  await newRowName(page).press("Escape");
  await expect(pane).not.toHaveAttribute("data-task-pane-draft", "true");
  await expect(paneName(pane)).toHaveValue(existing.name);

  await section.locator("[data-add-task-open]").first().click();
  await expect(pane).toHaveAttribute("data-task-pane-draft", "true");
  await expect(newRowName(page)).toBeFocused();
  await newRowName(page).press("Escape");
  await expect(pane).not.toHaveAttribute("data-task-pane-draft", "true");
  await expect(paneName(pane)).toHaveValue(existing.name);
});

test("quick creation keeps a closed pane closed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page, []);
  await page.goto(`/projects/${f.projectId}?view=list`);
  await waitForListHydration(page);

  await page.locator("[data-list-add]").click();
  const row = newRowName(page);
  await expect(row).toBeFocused();
  await expect(page.locator("[data-task-pane]")).toHaveCount(0);
  await row.press("Escape");
  await expect(page.locator("[data-task-pane]")).toHaveCount(0);
});

test("calendar clicks fill the active start then due field and keep start <= due", async ({ page }) => {
  await page.clock.setFixedTime(CLOCK);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page);
  const existing = f.tasks[0];
  const pane = await openPane(page, f.projectId, existing.id);

  const day = (value: number) => `2026-11-${String(value).padStart(2, "0")}`;
  const short = (value: number) => `11/${String(value).padStart(2, "0")}/26`;
  const patch = () => page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/tasks/${existing.id}` &&
    response.request().method() === "PATCH" && response.status() === 200);
  const saved = async () => (await savedTasks(page, f.projectId)).find((task) => task.id === existing.id)!;

  await pane.getByRole("button", { name: "期日を設定" }).click();
  const picker = page.locator("[data-due-picker]");
  await expect(picker).toBeVisible();
  await expect(picker.locator("[data-due-menu]")).toHaveAttribute("data-due-active-field", "start");
  await expect(picker.locator('[data-due-field="start"]')).toHaveAttribute("data-due-active", "true");

  let response = patch();
  await picker.locator(`[data-due-day="${day(10)}"]`).click();
  await response;
  await expect(picker.locator("[data-due-menu]")).toHaveAttribute("data-due-active-field", "due");
  await expect(picker.locator('[data-due-field="due"]')).toHaveAttribute("data-due-active", "true");
  await expect(picker.locator("[data-due-summary]")).toHaveText(short(10));
  expect(await saved()).toMatchObject({ start_on: day(10), due_on: null });

  response = patch();
  await picker.locator(`[data-due-day="${day(12)}"]`).click();
  await response;
  await expect(picker.locator("[data-due-summary]")).toHaveText(`${short(10)} – ${short(12)}`);
  await expect.poll(async () => {
    const task = await saved();
    return { start_on: task.start_on, due_on: task.due_on };
  }).toEqual({ start_on: day(10), due_on: day(12) });

  // Focusing start and choosing a later day pulls the due to the same day.
  await picker.locator('[data-due-field="start"]').click();
  await expect(picker.locator("[data-due-menu]")).toHaveAttribute("data-due-active-field", "start");
  response = patch();
  await picker.locator(`[data-due-day="${day(20)}"]`).click();
  await response;
  await expect(picker.locator("[data-due-summary]")).toHaveText(`${short(20)} – ${short(20)}`);
  await expect.poll(async () => {
    const task = await saved();
    return { start_on: task.start_on, due_on: task.due_on };
  }).toEqual({ start_on: day(20), due_on: day(20) });

  // Due-only tasks open with the due field active instead of start.
  const dueOnly = await page.request.post("/api/tasks", {
    data: { project_id: f.projectId, section_id: f.sectionId, name: "期日だけのタスク", due_on: day(28) },
  });
  expect(dueOnly.status()).toBe(201);
  const { id: dueOnlyId } = await dueOnly.json() as { id: number };
  await page.goto(`/projects/${f.projectId}?view=list&task=${dueOnlyId}`);
  const duePane = page.locator("[data-task-pane]");
  await expect(duePane).toBeVisible();
  await waitForListHydration(page);
  await duePane.getByRole("button", { name: "期日を設定" }).click();
  await expect(page.locator("[data-due-menu]")).toHaveAttribute("data-due-active-field", "due");
  await expect(page.locator('[data-due-field="due"]')).toHaveAttribute("data-due-active", "true");
});
