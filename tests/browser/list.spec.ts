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

test("list rows use a 38px line with inline counts and an ellipsized long name", async ({ page }) => {
  const today = todayISO();
  const createdIds: number[] = [];
  const longName = `E2E 長い件名 ${Date.now()} ${"とても長いタスク名を一列に収めるための確認用文言".repeat(4)}`;

  const created = await page.request.post("/api/tasks", {
    data: { project_id: 1, section_id: 2, name: longName, due_on: shiftDate(today, 7) },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: number };
  createdIds.push(id);

  const child = await page.request.post("/api/tasks", {
    data: { project_id: 1, parent_task_id: id, name: "E2E long name child" },
  });
  expect(child.status()).toBe(201);
  createdIds.push((await child.json() as { id: number }).id);
  const comment = await page.request.post("/api/comments", {
    data: { task_id: id, body: "E2E inline count comment" },
  });
  expect(comment.status()).toBe(201);

  try {
    await page.goto("/projects/1?view=list");
    const row = page.locator(`[data-list-row="${id}"]`);
    await expect(row).toBeVisible();

    const height = await row.evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBe(38);

    const name = row.locator("[data-list-task-name]");
    const nameStyle = await name.evaluate((element) => {
      const style = getComputedStyle(element);
      return { textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
    });
    expect(nameStyle).toEqual({ textOverflow: "ellipsis", whiteSpace: "nowrap" });
    expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await name.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(24);
    await expect(row.locator("[data-list-task-meta]")).toHaveText("子タスク 1 ・ コメント 1");

    const summary = page.locator("[data-list-summary]");
    await expect(summary).toContainText(/\d+件 ・ 完了 \d+/);
    await expect(page.locator("[data-list-section-header]").first().locator("[data-list-section-count]")).toBeVisible();

    const bodyCell = row.locator("> *").nth(2);
    expect(await bodyCell.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe("0px");
  } finally {
    for (const id of createdIds.reverse()) {
      await page.request.delete(`/api/tasks/${id}`);
      await page.request.delete(`/api/tasks/${id}?force=1`);
    }
  }
});

test("list completion control announces complete, overdue, in-progress and todo", async ({ page }) => {
  const today = todayISO();
  const yesterday = shiftDate(today, -1);
  const nextWeek = shiftDate(today, 7);
  const createdIds: number[] = [];
  const createTask = async (name: string, data: Record<string, unknown> = {}) => {
    const response = await page.request.post("/api/tasks", {
      data: { project_id: 1, section_id: 2, name, ...data },
    });
    expect(response.status()).toBe(201);
    const { id } = await response.json() as { id: number };
    createdIds.push(id);
    return id;
  };

  const completeId = await createTask(`E2E state complete ${Date.now()}`, { due_on: yesterday });
  const overdueId = await createTask(`E2E state overdue ${Date.now()}`, { due_on: yesterday });
  const progressId = await createTask(`E2E state progress ${Date.now()}`, { due_on: nextWeek });
  const todoId = await createTask(`E2E state todo ${Date.now()}`, { due_on: nextWeek });
  for (const [id, data] of [
    [completeId, { completed: true }],
    [progressId, { progress: 50 }],
  ] as const) {
    expect((await page.request.patch(`/api/tasks/${id}`, { data })).status()).toBe(200);
  }

  try {
    await page.goto("/projects/1?view=list");
    const expected = [
      [completeId, "完了", "完了（未完了に戻す）"],
      [overdueId, "遅延", "遅延（完了にする）"],
      [progressId, "進行中", "進行中（完了にする）"],
      [todoId, "未着手", "未着手（完了にする）"],
    ] as const;
    for (const [id, state, label] of expected) {
      const button = page.locator(`[data-list-row="${id}"]`).getByRole("button", { name: label, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("title", state);
      await expect(button.locator("svg circle")).toHaveCount(1);
    }

    const todoRow = page.locator(`[data-list-row="${todoId}"]`);
    await todoRow.getByRole("button", { name: "未着手（完了にする）", exact: true }).click();
    await expect(todoRow.getByRole("button", { name: "完了（未完了に戻す）", exact: true })).toBeVisible();
    await todoRow.getByRole("button", { name: "完了（未完了に戻す）", exact: true }).click();
    await expect(todoRow.getByRole("button", { name: "未着手（完了にする）", exact: true })).toBeVisible();
  } finally {
    for (const id of createdIds) {
      await page.request.delete(`/api/tasks/${id}`);
      await page.request.delete(`/api/tasks/${id}?force=1`);
    }
  }
});
