import { expect, test, type Page } from "@playwright/test";
import { todayISO } from "../../lib/dates";
import { shiftDate } from "../../lib/timeline-dnd";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

async function login(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("list rows have no divider between the drag handle and task name", async ({ page }) => {
  await page.goto("/projects/1?view=list");
  const row = page.locator('[data-list-row="1"]');
  await expect(row).toBeVisible();

  const nameCell = row.locator("> div").first();
  const borderLeft = await nameCell.evaluate((element) => getComputedStyle(element).borderLeftWidth);
  expect(borderLeft).toBe("0px");

  const header = page.locator("[data-field-add-button]").locator("..");
  const headerBorder = await header
    .locator("> *")
    .nth(1)
    .evaluate((element) => getComputedStyle(element).borderLeftWidth);
  expect(headerBorder).toBe("0px");
});

test("milestone icons replace the completion check and use Asana green", async ({ page }) => {
  const today = new Date().toLocaleDateString("en-CA");
  const created = await page.request.post("/api/tasks", {
    data: {
      project_id: 1,
      section_id: 2,
      name: `E2E milestone color ${Date.now()}`,
      is_milestone: true,
      start_on: today,
      due_on: today,
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: number };
  try {
    for (const view of ["list", "board", "calendar"]) {
      await page.goto(`/projects/1?view=${view}`);
      const container =
        view === "list"
          ? `[data-list-row="${id}"]`
          : view === "board"
            ? `[data-board-card="${id}"]`
            : `[data-calendar-single="${id}"]`;
      const icon = page.locator(`${container} [data-task-milestone]`);
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute("aria-label", "マイルストーン");
      await expect(icon).toHaveAttribute("title", "マイルストーン");
      const info = await icon.evaluate((element) => {
        const button = element.closest("button");
        const svg = element.querySelector("svg");
        return {
          label: button?.getAttribute("aria-label") ?? "",
          width: button ? getComputedStyle(button).width : "",
          height: button ? getComputedStyle(button).height : "",
          stroke: svg ? getComputedStyle(svg).stroke : "",
        };
      });
      expect(info.label).toContain("マイルストーン");
      expect(info.width).toBe("16px");
      expect(info.height).toBe("16px");
      expect(info.stroke).toBe("rgb(70, 167, 90)");
    }

    await page.request.patch(`/api/tasks/${id}`, { data: { completed: true } });
    await page.goto("/projects/1?view=list");
    const completed = page.locator(`[data-list-row="${id}"] [data-task-milestone]`);
    const completedInfo = await completed.evaluate((element) => {
      const svg = element.querySelector("svg");
      const paths = svg ? svg.querySelectorAll("path") : [];
      return {
        label: element.closest("button")?.getAttribute("aria-label") ?? "",
        fill: paths[0] ? getComputedStyle(paths[0]).fill : "",
        checkStroke: paths[1] ? getComputedStyle(paths[1]).stroke : "",
      };
    });
    expect(completedInfo.label).toContain("未完了");
    expect(completedInfo.fill).toBe("rgb(70, 167, 90)");
    expect(completedInfo.checkStroke).toBe("rgb(255, 255, 255)");
  } finally {
    await page.request.delete(`/api/tasks/${id}`);
    await page.request.delete(`/api/tasks/${id}?force=1`);
  }
});

test("due dates pair overdue and today colors with a shape cue and accessible state", async ({ page }) => {
  const meResponse = await page.request.get("/api/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json() as { id: number };
  const today = todayISO();
  const yesterday = shiftDate(today, -1);
  const createdIds: number[] = [];

  const createTask = async (name: string, due: string) => {
    const response = await page.request.post("/api/tasks", {
      data: { project_id: 1, section_id: 2, name, due_on: due, assignee_id: me.id },
    });
    expect(response.status()).toBe(201);
    const { id } = await response.json() as { id: number };
    createdIds.push(id);
    return id;
  };

  const overdueId = await createTask(`E2E overdue due cue ${Date.now()}`, yesterday);
  const todayId = await createTask(`E2E today due cue ${Date.now()}`, today);

  try {
    await page.goto("/projects/1?view=list");
    const overdueRow = page.locator(`[data-list-row="${overdueId}"]`);
    await expect(overdueRow).toContainText("期限超過");
    await expect(overdueRow.locator('[data-due-state="overdue"]').filter({ visible: true })).toHaveCount(1);
    const todayRow = page.locator(`[data-list-row="${todayId}"]`);
    await expect(todayRow).toContainText("今日が期日");
    await expect(todayRow.locator('[data-due-state="today"]').filter({ visible: true })).toHaveCount(1);

    await page.goto("/projects/1?view=board");
    const overdueCard = page.locator(`[data-board-card="${overdueId}"]`);
    await expect(overdueCard).toContainText("期限超過");
    await expect(overdueCard.locator('[data-due-state="overdue"]')).toHaveCount(1);

    await page.goto("/my-tasks");
    const myOverdueRow = page.locator(`[data-my-task-row="${overdueId}"]`);
    await expect(myOverdueRow).toContainText("期限超過");
    await expect(myOverdueRow.locator('[data-due-state="overdue"]')).toHaveCount(1);
    const myTodayRow = page.locator(`[data-my-task-row="${todayId}"]`);
    await expect(myTodayRow).toContainText("今日が期日");
    await expect(myTodayRow.locator('[data-due-state="today"]')).toHaveCount(1);

    await page.goto(`/projects/1?view=list&task=${overdueId}`);
    const dueButton = page.locator("[data-task-pane]").getByRole("button", { name: /^期限超過: / });
    await expect(dueButton).toBeVisible();
    await expect(dueButton).toHaveAttribute("title", /^期限超過: /);
    await expect(dueButton.locator('[data-due-state="overdue"]')).toHaveCount(1);
  } finally {
    for (const id of createdIds) {
      await page.request.delete(`/api/tasks/${id}`);
      await page.request.delete(`/api/tasks/${id}?force=1`);
    }
  }
});
