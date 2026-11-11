import { expect, test, type Locator, type Page } from "@playwright/test";
import { shiftDay } from "../../lib/calendar";
import { todayISO } from "../../lib/dates";
import type { DashboardChartType, DashboardFilter, DashboardGroupBy, DashboardMetric } from "../../lib/dashboard-types";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const projectsToRemove = new WeakMap<Page, number[]>();
const SPECIAL_STATUS = "確認 & 検証/中 #1";

test.afterEach(async ({ page }, info) => {
  info.setTimeout(15_000);
  for (const projectId of projectsToRemove.get(page) ?? []) {
    try {
      const response = await page.request.delete(`/api/projects/${projectId}`, { timeout: 5_000 });
      expect(response.status()).toBe(200);
    } catch (error) {
      if (info.status === info.expectedStatus) throw error;
      info.annotations.push({ type: "cleanup", description: `Project cleanup after the original failure: ${String(error)}` });
    }
  }
});

async function createProject(page: Page, name: string) {
  const response = await page.request.post("/api/projects", { data: { workspace_id: 1, name } });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: number };
  projectsToRemove.set(page, [...projectsToRemove.get(page) ?? [], id]);
  return id;
}

async function createSection(page: Page, projectId: number, name: string) {
  const response = await page.request.post("/api/sections", { data: { project_id: projectId, name } });
  expect(response.status()).toBe(201);
  return (await response.json() as { id: number }).id;
}

async function createTask(page: Page, projectId: number, sectionId: number | null, name: string,
  due: string | null, assigneeId: number | null, completed = false) {
  const response = await page.request.post("/api/tasks", {
    data: { project_id: projectId, section_id: sectionId, name, due_on: due, assignee_id: assigneeId },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: number };
  if (completed) {
    const changed = await page.request.patch(`/api/tasks/${id}`, { data: { completed: true } });
    expect(changed.status()).toBe(200);
  }
  return id;
}

async function fixture(page: Page) {
  const login = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const projectId = await createProject(page, `Dashboard navigation ${test.info().testId} ${Date.now()}`);
  const sectionName = "実行 & 検証/中 #1";
  const sectionId = await createSection(page, projectId, sectionName);
  const member = await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: 2, role: "editor" } });
  expect(member.status()).toBe(201);
  const today = todayISO();
  const donePast = await createTask(page, projectId, sectionId, "Done past due", shiftDay(today, -1), 1, true);
  const openPast = await createTask(page, projectId, sectionId, "Open past due", shiftDay(today, -1), 2);
  const openToday = await createTask(page, projectId, sectionId, "Open today", today, 2);
  const noDue = await createTask(page, projectId, null, "No assignee, section or due date", null, null);
  const doneEdge = await createTask(page, projectId, sectionId, "Done at inclusive week edge", shiftDay(today, 7), 1, true);
  // Initialize defaults before adding custom widgets, as the UI normally does.
  const defaults = await page.request.get(`/api/projects/${projectId}/dashboard/widgets`);
  expect(defaults.ok()).toBeTruthy();
  return { projectId, sectionId, sectionName, today, donePast, openPast, openToday, noDue, doneEdge,
    all: [donePast, openPast, openToday, noDue, doneEdge] };
}

async function addWidget(page: Page, projectId: number, title: string, chartType: DashboardChartType,
  groupBy: DashboardGroupBy, metric: DashboardMetric = "count", filters: DashboardFilter = {}) {
  const response = await page.request.post(`/api/projects/${projectId}/dashboard/widgets`, {
    data: { title, widget_type: "chart", chart_type: chartType, group_by: groupBy, metric, filters, options: {} },
  });
  expect(response.status()).toBe(201);
}

function widget(page: Page, title: string) {
  return page.locator("[data-dashboard-widget]").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function dashboard(page: Page, projectId: number) {
  await page.goto(`/projects/${projectId}?view=dashboard`);
  await expect(page.locator("[data-dashboard-view]")).toBeVisible();
}

async function screenshot(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function assertRows(page: Page, expected: number[]) {
  await expect(page.locator("[data-dashboard-drilldown]")).toBeVisible();
  await expect(async () => {
    const actual = await page.locator("[data-list-row]").evaluateAll((rows) =>
      rows.map((row) => Number(row.getAttribute("data-list-row"))).sort((a, b) => a - b));
    expect(actual).toEqual([...expected].sort((a, b) => a - b));
  }).toPass({ timeout: 5_000 });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function tableLink(card: Locator, category: string, series = 0) {
  const details = card.locator("[data-dashboard-chart-data]");
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
  return await datumLink(card, category, series, "table");
}

async function datumLink(card: Locator, category: string, series = 0, kind = "cell") {
  const link = card.locator(`[data-dashboard-chart-link="${kind}"][data-dashboard-chart-series="${series}"]`)
    .and(card.getByRole("link", { name: new RegExp(`、${escape(category)}、`) }));
  await expect(link).toHaveCount(1);
  return link;
}

test("number drilldowns ignore saved filters, keep preferences unchanged, and handle empty selections", async ({ page }) => {
  const f = await fixture(page);
  const zero = "Zero incomplete under completed filter";
  await addWidget(page, f.projectId, zero, "number", "completion", "incomplete", { completion: "done" });
  const stored = { mine_only: true, completed_only: true, hide_completed: false, status: "No matching stored status", due: "month", group: "assignee" };
  const save = await page.request.put("/api/view-state", { data: { project_id: f.projectId, view: "list", state: stored } });
  expect(save.ok()).toBeTruthy();
  const savedView = await page.request.post("/api/saved-views", {
    data: { project_id: f.projectId, name: "Conflicting saved dashboard view", filters: stored, sort_key: "due", group_by: "assignee" },
  });
  expect(savedView.status()).toBe(201);
  const { id: savedId } = await savedView.json() as { id: number };
  const storedBefore = await (await page.request.get(`/api/view-state?project_id=${f.projectId}&view=list`)).json();
  const listWrites: string[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/view-state") || request.method() !== "PUT") return;
    if ((request.postDataJSON() as { view?: string }).view === "list") listWrites.push(request.url());
  });
  await dashboard(page, f.projectId);
  for (const [title, expected] of [
    ["タスクの合計", f.all], ["完了したタスクの合計", [f.donePast, f.doneEdge]],
    ["未完了のタスクの合計", [f.openPast, f.openToday, f.noDue]], ["期限超過のタスクの合計", [f.openPast]],
    [zero, []],
  ] as const) {
    await widget(page, title).locator('[data-dashboard-chart-link="total"]').click();
    await assertRows(page, [...expected]);
    await expect(page.locator("[data-list-view]")).toHaveAttribute("data-list-mine-only", "false");
    await expect(page.locator("[data-list-view]")).toHaveAttribute("data-list-status", "");
    if (expected.length === 0) {
      const empty = page.locator('[data-empty-state="list"]');
      await expect(empty).toContainText("条件に一致するタスクがありません");
      await expect(empty.getByRole("button", { name: /タスクを追加/ })).toHaveCount(0);
      await screenshot(page, "dashboard-empty-drilldown");
    }
    await page.goBack();
    await expect(page.locator("[data-dashboard-view]")).toBeVisible();
  }
  // A manually combined saved= parameter must not replace the dashboard
  // selection either. Its ordinary preferences are still restored on clear.
  const allHref = await widget(page, "タスクの合計").locator('[data-dashboard-chart-link="total"]').getAttribute("href");
  const combined = new URL(allHref!, "http://fixture.invalid");
  combined.searchParams.set("saved", String(savedId));
  await page.goto(`${combined.pathname}${combined.search}`);
  await assertRows(page, f.all);
  await page.locator("[data-list-filter-open]").click();
  await page.locator('[data-list-quick-filter="mine"]').click();
  // The rows update optimistically before router.push commits history. Wait
  // for the URL so Back exercises this filter entry rather than the dashboard.
  await page.waitForURL((url) => url.searchParams.has("dashboard") && url.searchParams.get("mine") === "1");
  await assertRows(page, [f.donePast, f.doneEdge]);
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.has("dashboard") && !url.searchParams.has("mine"));
  await assertRows(page, f.all);
  await expect(page.locator("[data-list-view]")).toHaveAttribute("data-list-mine-only", "false");
  await page.goForward();
  await page.waitForURL((url) => url.searchParams.has("dashboard") && url.searchParams.get("mine") === "1");
  await assertRows(page, [f.donePast, f.doneEdge]);
  await expect(page.locator("[data-list-view]")).toHaveAttribute("data-list-mine-only", "true");
  // Task names enter inline editing. The row's Enter action opens details.
  const selectedRow = page.locator(`[data-list-row="${f.donePast}"]`);
  await selectedRow.focus();
  await selectedRow.press("Enter");
  await page.waitForURL((url) => url.searchParams.has("dashboard") && url.searchParams.get("mine") === "1"
    && url.searchParams.get("task") === String(f.donePast));
  const pane = page.locator("[data-task-pane]");
  await expect(pane).toBeVisible();
  await pane.getByRole("link", { name: "詳細を閉じる", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.has("dashboard") && url.searchParams.get("mine") === "1"
    && !url.searchParams.has("task"));
  await expect(pane).toHaveCount(0);
  await assertRows(page, [f.donePast, f.doneEdge]);
  await page.keyboard.press("Escape");
  await page.locator("[data-list-options-open]").click();
  await expect(page.getByRole("button", { name: "現在のビューを保存", exact: true })).toBeDisabled();
  await screenshot(page, "dashboard-drilldown-save-disabled");
  await page.keyboard.press("Escape");
  const storedAfter = await (await page.request.get(`/api/view-state?project_id=${f.projectId}&view=list`)).json();
  expect(storedAfter).toEqual(storedBefore);
  expect(listWrites).toHaveLength(0);
  await page.locator("[data-dashboard-clear]").click();
  await expect(page.locator("[data-dashboard-drilldown]")).toHaveCount(0);
  await expect(page.locator("[data-list-view]")).toHaveAttribute("data-list-mine-only", "true");
  await expect(page.locator("[data-list-view]")).toHaveAttribute("data-list-status", stored.status);
  // Ordinary lists retain their existing persistence and save capabilities.
  await page.locator("[data-list-options-open]").click();
  await expect(page.getByRole("button", { name: "現在のビューを保存", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.locator("[data-list-filter-open]").click();
  const ordinarySaved = page.waitForResponse((response) => response.url().endsWith("/api/view-state")
    && response.request().method() === "PUT" && (response.request().postDataJSON() as { view?: string }).view === "list");
  await page.locator('[data-list-quick-filter="mine"]').click();
  expect((await ordinarySaved).ok()).toBeTruthy();
  expect(listWrites).toHaveLength(1);
});

test("category and series links retain unassigned, completion, and encoded status conditions", async ({ page }) => {
  const f = await fixture(page);
  const status = await page.request.patch(`/api/tasks/${f.openToday}`, { data: { status: SPECIAL_STATUS } });
  expect(status.status()).toBe(200);
  await addWidget(page, f.projectId, "Assignee buckets", "bar", "assignee");
  await addWidget(page, f.projectId, "Stacked section buckets", "stacked_bar", "section");
  await addWidget(page, f.projectId, "Encoded status buckets", "bar", "status");
  for (const [title, label, series, kind, expected] of [
    ["Assignee buckets", "未割り当て", 0, "cell", [f.noDue]],
    ["タスクの合計 (完了ステータス別)", "完了", 0, "legend", [f.donePast, f.doneEdge]],
    ["Stacked section buckets", f.sectionName, 0, "cell", [f.openPast, f.openToday]],
    ["Stacked section buckets", f.sectionName, 1, "table", [f.donePast, f.doneEdge]],
    ["Encoded status buckets", SPECIAL_STATUS, 0, "cell", [f.openToday]],
  ] as const) {
    await dashboard(page, f.projectId);
    const card = widget(page, title);
    const link = kind === "table" ? await tableLink(card, label, series) : await datumLink(card, label, series, kind);
    if (label === SPECIAL_STATUS) {
      const href = await link.getAttribute("href");
      expect(new URL(href!, "http://fixture.invalid").searchParams.get("dashboard")).toContain(SPECIAL_STATUS);
    }
    await link.click();
    await assertRows(page, [...expected]);
  }
});

test("week and month bucket boundaries use dashboard's inclusive ranges", async ({ page }) => {
  const f = await fixture(page);
  const weekSection = await createSection(page, f.projectId, "Week boundaries");
  const weekInside = await createTask(page, f.projectId, weekSection, "Week plus seven", shiftDay(f.today, 7), null);
  await createTask(page, f.projectId, weekSection, "Week plus eight", shiftDay(f.today, 8), null);
  const monthSection = await createSection(page, f.projectId, "Month boundaries");
  const monthInside = await createTask(page, f.projectId, monthSection, "Month plus thirty", shiftDay(f.today, 30), null);
  await createTask(page, f.projectId, monthSection, "Month plus thirty-one", shiftDay(f.today, 31), null);
  await addWidget(page, f.projectId, "Inclusive week", "number", "completion", "count", { due: "week", section: weekSection });
  await addWidget(page, f.projectId, "Inclusive month", "number", "completion", "count", { due: "month", section: monthSection });
  for (const [title, id] of [["Inclusive week", weekInside], ["Inclusive month", monthInside]] as const) {
    await dashboard(page, f.projectId);
    await widget(page, title).locator('[data-dashboard-chart-link="total"]').click();
    await assertRows(page, [id]);
  }
});

test("multihome sections use the current project and malformed or foreign conditions fail closed", async ({ page }) => {
  const f = await fixture(page);
  const sourceProject = await createProject(page, "Separate dashboard source");
  const sourceSection = await createSection(page, sourceProject, "Primary home section");
  const shared = await createTask(page, sourceProject, sourceSection, "Shared dashboard task", f.today, null);
  const privateTask = await createTask(page, sourceProject, sourceSection, "Unshared source task", f.today, null);
  const joined = await page.request.post("/api/memberships", { data: { task_id: shared, project_id: f.projectId, section_id: f.sectionId } });
  expect(joined.status()).toBe(201);
  await dashboard(page, f.projectId);
  const link = await tableLink(widget(page, "未完了のタスクの合計 (セクション別)"), f.sectionName);
  const href = await link.getAttribute("href");
  await link.click();
  await assertRows(page, [f.openPast, f.openToday, shared]);
  await expect(page.locator(`[data-list-row="${privateTask}"]`)).toHaveCount(0);
  const foreign = new URL(href!, "http://fixture.invalid");
  const descriptor = JSON.parse(foreign.searchParams.get("dashboard")!) as { filters: DashboardFilter };
  descriptor.filters.section = sourceSection;
  foreign.searchParams.set("dashboard", JSON.stringify(descriptor));
  await page.goto(`${foreign.pathname}${foreign.search}`);
  await assertRows(page, []);
  await page.goto(`/projects/${f.projectId}?view=list&dashboard=${encodeURIComponent("{malformed")}`);
  await assertRows(page, []);
  await expect(page.locator("[data-dashboard-drilldown]").getByRole("alert")).toBeVisible();
});

test("a viewer can open year-specific month buckets with the keyboard", async ({ page, browser }) => {
  const f = await fixture(page);
  const monthSection = await createSection(page, f.projectId, "Year-specific buckets");
  const december = await createTask(page, f.projectId, monthSection, "December cutoff task", "2026-12-31", null);
  const january = await createTask(page, f.projectId, monthSection, "January cutoff task", "2027-01-01", null);
  await addWidget(page, f.projectId, "Year-specific due months", "bar", "due_month", "count", { section: monthSection });
  const member = await page.request.post(`/api/projects/${f.projectId}/members`, { data: { user_id: 3, role: "viewer" } });
  expect(member.status()).toBe(201);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const login = await context.request.post("/api/auth/login", { data: { email: "sato@example.com", password: PASSWORD } });
    expect(login.ok()).toBeTruthy();
    const viewer = await context.newPage();
    await viewer.setViewportSize({ width: 820, height: 900 });
    for (const [month, id] of [["2026/12", december], ["2027/01", january]] as const) {
      await dashboard(viewer, f.projectId);
      const card = widget(viewer, "Year-specific due months");
      await card.scrollIntoViewIfNeeded();
      const link = await tableLink(card, month);
      await link.focus();
      await expect(link).toBeFocused();
      await viewer.keyboard.press("Enter");
      await assertRows(viewer, [id]);
      await expect(viewer.locator("[data-dashboard-clear]")).toBeVisible();
      if (month === "2026/12") {
        await screenshot(viewer, "dashboard-viewer-keyboard-drilldown");
      }
    }
  } finally {
    await context.close();
  }
});
