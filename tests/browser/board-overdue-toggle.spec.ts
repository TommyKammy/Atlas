import { expect, test, type Page } from "@playwright/test";
import { todayISO } from "../../lib/dates";
import { shiftDate } from "../../lib/timeline-dnd";

const credentials = {
  email: process.env.E2E_EMAIL ?? "admin@example.com",
  password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
};
const fixtures = new WeakMap<Page, number>();

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});

test.afterEach(async ({ page }) => {
  const projectId = fixtures.get(page);
  if (projectId === undefined) return;
  await page.goto("about:blank");
  expect((await page.request.delete(`/api/projects/${projectId}`)).status()).toBe(200);
});

async function fixture(page: Page) {
  const response = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Board overdue ${test.info().testId} ${Date.now()}` },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: number };
  fixtures.set(page, id);
  const lookup = await page.request.get(`/api/lookup?project_id=${id}`);
  expect(lookup.status()).toBe(200);
  const sections = await lookup.json() as { id: number }[];
  return { projectId: id, sectionId: sections[0].id };
}

async function createTask(
  page: Page,
  projectId: number,
  sectionId: number,
  data: Record<string, unknown>,
) {
  const response = await page.request.post("/api/tasks", {
    data: { project_id: projectId, section_id: sectionId, ...data },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { id: number }).id;
}

test("board overdue toggle shares the due filter and counts unfinished overdue tasks", async ({ page }) => {
  const { projectId, sectionId } = await fixture(page);
  const today = todayISO();
  const yesterday = shiftDate(today, -1);
  const nextWeek = shiftDate(today, 7);

  const overdueId = await createTask(page, projectId, sectionId, {
    name: "E2E 要対応 期限超過",
    due_on: yesterday,
  });
  const overdueProgressId = await createTask(page, projectId, sectionId, {
    name: "E2E 要対応 進行中の期限超過",
    due_on: yesterday,
    progress: 40,
  });
  const completedOverdueId = await createTask(page, projectId, sectionId, {
    name: "E2E 要対応 完了済みの期限超過",
    due_on: yesterday,
  });
  expect((await page.request.patch(`/api/tasks/${completedOverdueId}`, {
    data: { completed: true },
  })).status()).toBe(200);
  const dueTodayId = await createTask(page, projectId, sectionId, {
    name: "E2E 要対応 今日が期日",
    due_on: today,
  });
  const futureId = await createTask(page, projectId, sectionId, {
    name: "E2E 要対応 将来の期日",
    due_on: nextWeek,
  });

  await page.goto(`/projects/${projectId}?view=board`);
  const toggle = page.locator("[data-board-overdue-toggle]");
  const view = page.locator("[data-board-view]");

  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("data-board-overdue-count", "2");
  await expect(toggle).toHaveText("要対応 2");
  await expect(toggle).toBeEnabled();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveText("要対応 2");
  await expect(view).toHaveAttribute("data-board-due", "overdue");
  await expect(page).toHaveURL(/[?&]due=overdue(?:&|$)/);
  await expect(page.locator(`[data-board-card="${overdueId}"]`)).toBeVisible();
  await expect(page.locator(`[data-board-card="${overdueProgressId}"]`)).toBeVisible();
  await expect(page.locator(`[data-board-card="${dueTodayId}"]`)).toHaveCount(0);
  // The filter matches the count: completed overdue tasks are not shown.
  await expect(page.locator(`[data-board-card="${completedOverdueId}"]`)).toHaveCount(0);
  await expect(page.locator("[data-board-card]")).toHaveCount(2);
  await expect(page.locator(`[data-board-card="${futureId}"]`)).toHaveCount(0);

  // The same due=overdue state is shown in the filter menu.
  await page.locator("[data-board-filter-open]").click();
  const dueFilter = page.locator('[data-list-filter-input="due"]');
  await expect(dueFilter).toHaveValue("overdue");
  await dueFilter.selectOption("today");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(view).toHaveAttribute("data-board-due", "today");
  await dueFilter.selectOption("overdue");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(view).toHaveAttribute("data-board-due", "overdue");

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-board-filter-menu]")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(view).toHaveAttribute("data-board-due", "");
  await expect(page).not.toHaveURL(/[?&]due=/);
});

test("board overdue toggle stays available and quiet when the count is zero", async ({ page }) => {
  const { projectId, sectionId } = await fixture(page);
  await createTask(page, projectId, sectionId, {
    name: "E2E 要対応 なし",
    due_on: shiftDate(todayISO(), 7),
  });

  await page.goto(`/projects/${projectId}?view=board`);
  const toggle = page.locator("[data-board-overdue-toggle]");
  const view = page.locator("[data-board-view]");

  await expect(toggle).toHaveAttribute("data-board-overdue-count", "0");
  await expect(toggle).toHaveText("要対応 0");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toHaveClass(/bg-accent-soft/);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveClass(/bg-accent-soft/);
  await expect(view).toHaveAttribute("data-board-due", "overdue");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(view).toHaveAttribute("data-board-due", "");
});
