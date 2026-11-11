import { expect, test, type Page } from "@playwright/test";

const projects = new WeakMap<Page, number>();
test.afterEach(async ({ page }, info) => {
  const projectId = projects.get(page);
  if (!projectId) return;
  const response = await page.request.delete(`/api/projects/${projectId}`);
  if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
});

async function fixture(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" } })).status()).toBe(200);
  const project = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `List history ${test.info().testId} ${Date.now()}` } });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  projects.set(page, projectId);
  expect((await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: 2, role: "editor" } })).status()).toBe(201);
  const tasks: number[] = [];
  for (const [name, assignee, completed] of [["My history task", 1, false], ["Other history task", 2, false], ["Done history task", 2, true]] as const) {
    const response = await page.request.post("/api/tasks", { data: { project_id: projectId, name, assignee_id: assignee } });
    expect(response.status()).toBe(201);
    const { id } = await response.json() as { id: number };
    tasks.push(id);
    if (completed) expect((await page.request.patch(`/api/tasks/${id}`, { data: { completed: true } })).status()).toBe(200);
  }
  expect((await page.request.put("/api/view-state", { data: { project_id: projectId, view: "list", state: {} } })).status()).toBe(200);
  return { projectId, mine: tasks[0], other: tasks[1], done: tasks[2], all: tasks };
}

async function rows(page: Page, expected: number[]) {
  await expect(async () => {
    const ids = await page.locator("[data-list-row]").evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("data-list-row"))).sort((a, b) => a - b));
    expect(ids).toEqual([...expected].sort((a, b) => a - b));
  }).toPass();
}

test("EV07 ordinary list Back/Forward restores conditions and detail close retains its history snapshot", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/projects/${f.projectId}?view=list`);
  const view = page.locator("[data-list-view]");
  await expect(view).toHaveAttribute("data-list-mine-only", "false");
  await page.waitForURL((url) => url.searchParams.get("list_state") === "1");
  await rows(page, f.all);
  await page.locator("[data-list-filter-open]").click();
  await page.locator('[data-list-quick-filter="mine"]').click();
  await page.waitForURL((url) => url.searchParams.get("mine") === "1");
  await expect(view).toHaveAttribute("data-list-mine-only", "true");
  await rows(page, [f.mine]);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-list-filter-menu]")).toHaveCount(0);
  // Ensure Back is tested after the stored preference has changed too.
  await expect(async () => {
    const response = await page.request.get(`/api/view-state?project_id=${f.projectId}&view=list`);
    expect(response.ok()).toBe(true);
    expect(JSON.stringify(await response.json())).toContain('"mine_only":true');
  }).toPass();
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("list_state") === "1" && !url.searchParams.has("mine"));
  await expect(view).toHaveAttribute("data-list-mine-only", "false");
  await rows(page, f.all);
  await page.goForward();
  await page.waitForURL((url) => url.searchParams.get("mine") === "1");
  await expect(view).toHaveAttribute("data-list-mine-only", "true");
  await rows(page, [f.mine]);
  const row = page.locator(`[data-list-row="${f.mine}"]`);
  await row.focus();
  await row.press("Enter");
  await expect(page.locator("[data-task-pane]")).toBeVisible();
  await page.getByRole("link", { name: "詳細を閉じる", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("list_state") === "1" && url.searchParams.get("mine") === "1" && !url.searchParams.has("task"));
  await rows(page, [f.mine]);
});

test("EV07 saved-view switching restores its own filters and sort direction instead of ordinary preferences", async ({ page }) => {
  const f = await fixture(page);
  const saved: number[] = [];
  for (const data of [
    { name: "Legacy mine view", filters: { mine_only: true }, sort_key: "name", group_by: "section" },
    { name: "Descending done view", filters: { completed_only: true, sortdir: "desc" }, sort_key: "progress", group_by: "section" },
  ]) {
    const response = await page.request.post("/api/saved-views", { data: { project_id: f.projectId, ...data } });
    expect(response.status()).toBe(201);
    saved.push((await response.json() as { id: number }).id);
  }
  expect((await page.request.put("/api/view-state", { data: { project_id: f.projectId, view: "list", state: { sortdir: "desc", completed_only: true } } })).status()).toBe(200);
  await page.goto(`/projects/${f.projectId}?view=list&saved=${saved[0]}`);
  const view = page.locator("[data-list-view]");
  await expect(view).toHaveAttribute("data-list-sortdir", "asc");
  await rows(page, [f.mine]);
  await page.getByRole("link", { name: "Descending done view", exact: true }).click();
  await expect(view).toHaveAttribute("data-list-sort", "progress");
  await expect(view).toHaveAttribute("data-list-sortdir", "desc");
  await expect(view).toHaveAttribute("data-list-mine-only", "false");
  await rows(page, [f.done]);
  await page.goBack();
  await expect(view).toHaveAttribute("data-list-sortdir", "asc");
  await expect(view).toHaveAttribute("data-list-mine-only", "true");
  await rows(page, [f.mine]);
  await page.goForward();
  await expect(view).toHaveAttribute("data-list-sortdir", "desc");
  await rows(page, [f.done]);
});

test("EV07 live refresh retains a focused list draft and its DOM input", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/projects/${f.projectId}?view=list`);
  await page.waitForURL((url) => url.searchParams.get("list_state") === "1");
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
  });
  const row = page.locator(`[data-list-row="${f.mine}"]`);
  await row.getByText("My history task", { exact: true }).click();
  const input = row.getByRole("textbox", { name: "タスク名", exact: true });
  await input.fill("Unsubmitted list draft");
  const element = await input.elementHandle();
  const refreshed = page.waitForResponse((response) => response.request().headers().rsc === "1" && new URL(response.url()).pathname === `/projects/${f.projectId}`);
  expect((await page.request.patch(`/api/tasks/${f.other}`, { data: { progress: 60 } })).status()).toBe(200);
  await refreshed;
  await expect(page.locator(`[data-list-row="${f.other}"]`)).toContainText("60%");
  await expect(input).toHaveValue("Unsubmitted list draft");
  await expect(input).toBeFocused();
  expect(await input.evaluate((node, previous) => node === previous, element)).toBe(true);
  expect(documents).toEqual([]);
  await input.press("Escape");
});
