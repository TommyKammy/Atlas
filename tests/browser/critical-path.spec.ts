import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const projectsToRemove = new WeakMap<Page, number>();
type TimelineFixture = { projectId: number; sectionId: number };

test.afterEach(async ({ page }, info) => {
  info.setTimeout(10_000);
  const projectId = projectsToRemove.get(page);
  if (projectId === undefined) return;
  try {
    const response = await page.request.delete(`/api/projects/${projectId}`, { timeout: 5_000 });
    expect(response.status()).toBe(200);
  } catch (error) {
    if (info.status === info.expectedStatus) throw error;
    info.annotations.push({ type: "cleanup", description: `Project cleanup after the original failure: ${String(error)}` });
  }
});

async function fixture(page: Page): Promise<TimelineFixture> {
  const login = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Critical path ${test.info().testId} ${Date.now()}` },
  });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  projectsToRemove.set(page, projectId);
  // Timeline groups are built from project sections. Use an explicit fixture
  // section so these tasks are rendered instead of entering the null section.
  const section = await page.request.post("/api/sections", {
    data: { project_id: projectId, name: "Critical path tasks" },
  });
  expect(section.status()).toBe(201);
  const { id: sectionId } = await section.json() as { id: number };
  // Zoom is persisted per user/project; a zoom query parameter is ignored.
  const viewState = await page.request.put("/api/view-state", {
    data: { project_id: projectId, view: "timeline", state: { zoom: 3, critical: true } },
  });
  expect(viewState.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { projectId, sectionId };
}

async function createTask(page: Page, { projectId, sectionId }: TimelineFixture, name: string, start: string | null,
  due: string, extra: { assignee_id?: number; is_milestone?: boolean } = {}) {
  const response = await page.request.post("/api/tasks", {
    data: { project_id: projectId, section_id: sectionId, name, start_on: start, due_on: due, ...extra },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { id: number }).id;
}

async function link(page: Page, from: number, to: number) {
  const response = await page.request.post("/api/dependencies", { data: { task_id: to, depends_on_id: from } });
  expect(response.status()).toBe(201);
}

const bar = (page: Page, id: number) => page.locator(`[data-timeline-bar="${id}"]`);

async function criticalDisplay(page: Page, enabled: boolean) {
  const checkbox = page.getByRole("checkbox", { name: "クリティカルパスを表示", exact: true });
  await expect(async () => {
    if (!await checkbox.isVisible()) await page.locator("[data-timeline-options-open]").click();
    await expect(checkbox).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5_000 });
  await checkbox.setChecked(enabled);
  await expect(checkbox).toBeChecked({ checked: enabled });
  await page.keyboard.press("Escape");
  await expect(checkbox).toHaveCount(0);
}

async function changeZoom(page: Page, label: string, preset: string, zoom: number) {
  const menu = page.locator("[data-timeline-zoom-menu]");
  await expect(async () => {
    if (!await menu.isVisible()) await page.getByRole("button", { name: /^ズームレベル:/ }).click();
    await expect(menu).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5_000 });
  const saved = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/view-state") || response.request().method() !== "PUT") return false;
    const body = response.request().postDataJSON() as { view?: string; state?: { zoom?: number } };
    return body.view === "timeline" && body.state?.zoom === zoom;
  });
  await menu.locator(`[data-timeline-zoom-option="${label}"]`).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-timeline-zoom-preset", preset);
}

async function assertCritical(page: Page, ids: number[], expected: boolean) {
  for (const id of ids) {
    await expect(bar(page, id)).toHaveAttribute("data-timeline-critical-task", String(expected));
  }
}

/** Resolve a semantic token to the rgb() string the browser computes for it. */
async function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, token);
}

test("date windows and zoom preserve the critical path through an offscreen predecessor", async ({ page }) => {
  const f = await fixture(page);
  const { projectId } = f;
  const a = await createTask(page, f, "Long predecessor outside hour window", "2026-01-01", "2026-01-20");
  const b = await createTask(page, f, "Final dependent task", "2026-02-01", "2026-02-05");
  // Both alternatives finish on the project deadline. C beats B alone,
  // while the complete A -> B chain beats C, so scope mistakes flip them.
  const c = await createTask(page, f, "Visible shorter competing path", "2026-01-25", "2026-02-05");
  await link(page, a, b);

  await page.goto(`/projects/${projectId}?view=timeline&from=2026-01-01`);
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-timeline-zoom-preset", "month");
  await criticalDisplay(page, true);
  await assertCritical(page, [a, b], true);
  await assertCritical(page, [c], false);

  // Hour view clamps the date axis to 31 days. The predecessor is absent
  // from the render graph but must remain part of the project calculation.
  await changeZoom(page, "時間", "hour", 0);
  await page.goto(`/projects/${projectId}?view=timeline&from=2026-01-21`);
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-timeline-zoom-preset", "hour");
  await criticalDisplay(page, true);
  await expect(bar(page, a)).toHaveCount(0);
  await assertCritical(page, [b], true);
  await assertCritical(page, [c], false);
  await changeZoom(page, "週", "week", 2);
  await assertCritical(page, [b], true);
  await assertCritical(page, [c], false);
});

test("assignee and completed filters do not recalculate critical paths from visible tasks", async ({ page }) => {
  const f = await fixture(page);
  const { projectId } = f;
  const member = await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: 2, role: "editor" } });
  expect(member.status()).toBe(201);
  const a = await createTask(page, f, "Completed hidden predecessor", "2026-01-01", "2026-01-20", { assignee_id: 1 });
  const b = await createTask(page, f, "Assigned dependent task", "2026-02-01", "2026-02-05", { assignee_id: 2 });
  const c = await createTask(page, f, "Assigned competing path", "2026-01-25", "2026-02-05", { assignee_id: 2 });
  await link(page, a, b);
  const completed = await page.request.patch(`/api/tasks/${a}`, { data: { completed: true } });
  expect(completed.ok()).toBeTruthy();

  await page.goto(`/projects/${projectId}?view=timeline&from=2026-01-01`);
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-timeline-zoom-preset", "month");
  await criticalDisplay(page, true);
  await assertCritical(page, [a, b], true);
  await assertCritical(page, [c], false);
  // Completed bars use the quiet surface-subtle / muted treatment, never the
  // critical ring or a status fill. The accessible state carries completion.
  await expect(bar(page, a)).toHaveCSS("background-color", await tokenColor(page, "--atlas-surface-subtle"));
  await expect(bar(page, a)).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-line"));
  await expect(bar(page, a)).toHaveAttribute("data-timeline-bar-state", "complete");
  await expect(
    bar(page, a)
      .locator(`[data-timeline-bar-name="${a}"], [data-timeline-bar-label="${a}"]`)
      .first(),
  ).toHaveCSS("text-decoration-line", "line-through");
  await expect(bar(page, a)).not.toHaveClass(/bg-danger-line|bg-red-/);

  await page.locator("[data-timeline-filter-open]").click();
  const filters = page.locator("[data-timeline-filter-menu]");
  await filters.locator("[data-list-filter-add]").click();
  await filters.locator('[data-list-filter-add-option="assignee"]').click();
  const assignee = filters.locator('[data-list-filter-input="assignee"]');
  await assignee.selectOption("2");
  await expect(bar(page, a)).toHaveCount(0);
  await assertCritical(page, [b], true);
  await assertCritical(page, [c], false);

  await assignee.selectOption("");
  await expect(bar(page, a)).toHaveCount(1);
  await filters.locator('[data-list-quick-filter="open"]').click();
  await expect(bar(page, a)).toHaveCount(0);
  await assertCritical(page, [b], true);
  await assertCritical(page, [c], false);
});

test("all tied paths and a zero-duration milestone are highlighted and the option disables them", async ({ page }) => {
  const f = await fixture(page);
  const { projectId } = f;
  const a = await createTask(page, f, "Diamond start", "2026-01-01", "2026-01-01");
  const b = await createTask(page, f, "Equal upper branch", "2026-01-02", "2026-01-03");
  const c = await createTask(page, f, "Equal lower branch", "2026-01-02", "2026-01-03");
  // A milestone can retain a start date from a former normal task. Its
  // weight must still be zero, or the tied independent path disappears.
  const milestone = await createTask(page, f, "Final milestone", "2026-01-01", "2026-01-04", { is_milestone: true });
  const completedMilestone = await createTask(page, f, "Completed final milestone", "2026-01-01", "2026-01-04", { is_milestone: true });
  const independent = await createTask(page, f, "Equal independent path", "2026-01-01", "2026-01-04");
  for (const [from, to] of [[a, b], [a, c], [b, milestone], [c, milestone], [b, completedMilestone], [c, completedMilestone]]) await link(page, from, to);
  const completed = await page.request.patch(`/api/tasks/${completedMilestone}`, { data: { completed: true } });
  expect(completed.ok()).toBeTruthy();
  const allCritical = [a, b, c, milestone, completedMilestone, independent];

  await page.goto(`/projects/${projectId}?view=timeline&from=2026-01-01`);
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-timeline-zoom-preset", "month");
  await criticalDisplay(page, true);
  await assertCritical(page, allCritical, true);
  const criticalIcon = bar(page, milestone).locator('[data-task-milestone-critical="true"]');
  await expect(criticalIcon).toHaveCount(1);
  await expect(criticalIcon).toHaveAttribute("title", "クリティカルパス上のマイルストーン");
  await expect(criticalIcon).toHaveAttribute("aria-label", "クリティカルパス上のマイルストーン");
  const completedIcon = bar(page, completedMilestone).locator("[data-task-milestone]");
  await expect(completedIcon).toHaveAttribute("data-task-milestone-completed", "true");
  await expect(completedIcon).not.toHaveAttribute("data-task-milestone-critical", "true");
  await expect(completedIcon).toHaveAttribute("title", "マイルストーン");
  await expect(completedIcon).toHaveAttribute("aria-label", "マイルストーン");
  await expect(completedIcon).not.toHaveClass(/(?:bg|ring)-red-/);
  await criticalDisplay(page, false);
  await assertCritical(page, allCritical, false);
  await expect(bar(page, milestone).locator('[data-task-milestone-critical="true"]')).toHaveCount(0);
  await criticalDisplay(page, true);
  await assertCritical(page, allCritical, true);
  await expect(completedIcon).not.toHaveClass(/(?:bg|ring)-red-/);
});
