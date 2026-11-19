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
    data: { workspace_id: 1, name: `Board card ${test.info().testId} ${Date.now()}` },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: number };
  fixtures.set(page, id);
  const lookup = await page.request.get(`/api/lookup?project_id=${id}`);
  expect(lookup.status()).toBe(200);
  const sections = await lookup.json() as { id: number; name: string }[];
  return { projectId: id, section: sections[0] };
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

async function tokenBackgrounds(page: Page, tokens: string[]) {
  return page.evaluate((names) => {
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const values: Record<string, string> = {};
    for (const name of names) {
      probe.style.backgroundColor = `var(${name})`;
      values[name] = getComputedStyle(probe).backgroundColor;
    }
    probe.remove();
    return values;
  }, tokens);
}

test("board cards and columns use the workbench surfaces, states and inline counts", async ({ page }) => {
  const { projectId, section } = await fixture(page);
  const today = todayISO();
  const yesterday = shiftDate(today, -1);
  const nextWeek = shiftDate(today, 7);

  const completeId = await createTask(page, projectId, section.id, {
    name: "E2E ボード 完了",
    due_on: yesterday,
  });
  expect((await page.request.patch(`/api/tasks/${completeId}`, {
    data: { completed: true, progress: 100 },
  })).status()).toBe(200);
  const overdueId = await createTask(page, projectId, section.id, {
    name: "E2E ボード 遅延",
    due_on: yesterday,
  });
  const progressId = await createTask(page, projectId, section.id, {
    name: "E2E ボード 進行中",
    due_on: nextWeek,
  });
  expect((await page.request.patch(`/api/tasks/${progressId}`, {
    data: { progress: 50 },
  })).status()).toBe(200);
  const todoId = await createTask(page, projectId, section.id, {
    name: "E2E ボード 未着手",
    due_on: nextWeek,
  });
  expect((await page.request.post("/api/tasks", {
    data: { project_id: projectId, parent_task_id: todoId, name: "E2E ボード 子タスク" },
  })).status()).toBe(201);
  expect((await page.request.post("/api/comments", {
    data: { task_id: todoId, body: "E2E ボード コメント" },
  })).status()).toBe(201);

  await page.goto(`/projects/${projectId}?view=board`);
  const column = page.locator(`[data-board-column="s${section.id}"]`);
  await expect(column).toBeVisible();

  const tokens = await tokenBackgrounds(page, ["--atlas-surface", "--atlas-surface-subtle"]);
  const columnStyle = await column.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      radius: style.borderRadius,
    };
  });
  expect(columnStyle.background).toBe(tokens["--atlas-surface-subtle"]);
  expect(columnStyle.border).toBe("0px");
  expect(columnStyle.radius).toBe("8px");

  const card = page.locator(`[data-board-card="${overdueId}"]`);
  await expect(card).toBeVisible();
  const cardStyle = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      radius: style.borderRadius,
      padding: style.padding,
      shadow: style.boxShadow,
    };
  });
  expect(cardStyle.background).toBe(tokens["--atlas-surface"]);
  expect(cardStyle.border).toBe("1px");
  expect(cardStyle.radius).toBe("8px");
  expect(cardStyle.padding).toBe("12px");
  expect(cardStyle.shadow).toBe("none");

  const cards = column.locator("[data-board-card]");
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first && second).toBeTruthy();
  expect(second!.y - (first!.y + first!.height)).toBeCloseTo(8, 0);

  const expected = [
    [completeId, "完了（未完了に戻す）"],
    [overdueId, "遅延（完了にする）"],
    [progressId, "進行中（完了にする）"],
    [todoId, "未着手（完了にする）"],
  ] as const;
  for (const [id, label] of expected) {
    await expect(page.locator(`[data-board-card="${id}"]`).getByRole("button", {
      name: label,
      exact: true,
    })).toBeVisible();
  }

  const todoCard = page.locator(`[data-board-card="${todoId}"]`);
  await expect(todoCard).toContainText("子タスク 1 ・ コメント 1");
  await expect(todoCard.locator("[data-board-subtask-badge]")).toHaveText("子タスク 1");
  await expect(todoCard.locator("[data-board-comment-badge]")).toHaveText("コメント 1");

  // The board options still hide and restore the subtask/comment counts.
  const options = page.getByRole("dialog", { name: "ボードのオプション", exact: true });
  for (const visible of [false, true]) {
    await page.locator("[data-board-options-open]").click();
    await expect(options).toBeVisible();
    await options.getByRole("checkbox", { name: "サブタスク・コメント", exact: true }).setChecked(visible);
    await options.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(options).toBeHidden();
    await expect(todoCard.locator("[data-board-subtask-badge]")).toHaveCount(visible ? 1 : 0);
    await expect(todoCard.locator("[data-board-comment-badge]")).toHaveCount(visible ? 1 : 0);
  }

  const progressCard = page.locator(`[data-board-card="${progressId}"]`);
  const progressBar = progressCard.locator('[data-board-progress="50"]');
  await expect(progressBar).toBeVisible();
  expect(await progressBar.evaluate((element) => element.getBoundingClientRect().height)).toBe(3);
  await expect(page.locator(`[data-board-card="${completeId}"]`).locator("[data-board-progress]")).toHaveCount(0);

  await todoCard.getByRole("button", { name: "未着手（完了にする）", exact: true }).click();
  await expect(todoCard.getByRole("button", { name: "完了（未完了に戻す）", exact: true })).toBeVisible();
  await todoCard.getByRole("button", { name: "完了（未完了に戻す）", exact: true }).click();
  await expect(todoCard.getByRole("button", { name: "未着手（完了にする）", exact: true })).toBeVisible();
});
