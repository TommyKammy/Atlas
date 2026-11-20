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

async function tokenColors(page: Page, tokens: string[]) {
  return page.evaluate((names) => {
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const values: Record<string, string> = {};
    for (const name of names) {
      probe.style.color = `var(${name})`;
      values[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    return values;
  }, tokens);
}

test("board cards and columns use the workbench surfaces, states and inline counts", async ({ page }) => {
  const { projectId, section } = await fixture(page);
  const me = await (await page.request.get("/api/me")).json() as { id: number; name: string };
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
    assignee_id: me.id,
  });
  expect((await page.request.patch(`/api/tasks/${progressId}`, {
    data: { progress: 50 },
  })).status()).toBe(200);
  const todoId = await createTask(page, projectId, section.id, {
    name: "E2E ボード 未着手",
    due_on: nextWeek,
  });
  expect((await page.request.patch(`/api/tasks/${todoId}`, {
    data: { status: "進行中" },
  })).status()).toBe(200);
  expect((await page.request.post("/api/tasks", {
    data: { project_id: projectId, parent_task_id: todoId, name: "E2E ボード 子タスク" },
  })).status()).toBe(201);
  expect((await page.request.post("/api/comments", {
    data: { task_id: todoId, body: "E2E ボード コメント" },
  })).status()).toBe(201);

  await page.goto(`/projects/${projectId}?view=board`);
  const column = page.locator(`[data-board-column="s${section.id}"]`);
  await expect(column).toBeVisible();

  const tokens = await tokenBackgrounds(page, [
    "--atlas-surface",
    "--atlas-surface-subtle",
    "--atlas-surface-muted",
    "--atlas-text",
    "--atlas-success",
  ]);
  const tokenText = await tokenColors(page, ["--atlas-text-muted"]);

  const columnStyle = await column.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      radius: style.borderRadius,
      padding: style.padding,
    };
  });
  expect(columnStyle.background).toBe("rgba(0, 0, 0, 0)");
  expect(columnStyle.background).not.toBe(tokens["--atlas-surface-subtle"]);
  expect(columnStyle.border).toBe("0px");
  expect(columnStyle.radius).toBe("0px");
  expect(columnStyle.padding).toBe("0px");

  // Columns float on the page background with a 16px gap, as in the mockup.
  const columns = page.locator("[data-board-columns]");
  expect(await columns.evaluate((element) => getComputedStyle(element).columnGap)).toBe("16px");
  const columnBoxes = await page.locator("[data-board-column]").evaluateAll((elements) =>
    elements.slice(0, 2).map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    }),
  );
  expect(columnBoxes).toHaveLength(2);
  expect(columnBoxes[1].x - (columnBoxes[0].x + columnBoxes[0].width)).toBeCloseTo(16, 0);

  const header = column.locator("[data-board-column-header]");
  const headerStyle = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight };
  });
  expect(headerStyle).toEqual({ fontSize: "13px", fontWeight: "700" });
  const count = column.locator("[data-board-column-count]");
  await expect(count).toHaveText(String(await column.locator("[data-board-card]").count()));
  const countStyle = await count.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color };
  });
  expect(countStyle).toEqual({ fontSize: "13px", fontWeight: "400", color: tokenText["--atlas-text-muted"] });
  await expect(column.locator("[data-board-column-add]")).toHaveAccessibleName(
    `${section.name}にタスクを追加`,
  );
  await expect(column.locator("[data-add-task-open]")).toBeVisible();

  const card = page.locator(`[data-board-card="${overdueId}"]`);
  await expect(card).toBeVisible();
  const cardStyle = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      radius: style.borderRadius,
      padding: style.padding,
      gap: style.gap,
      display: style.display,
      direction: style.flexDirection,
      shadow: style.boxShadow,
    };
  });
  expect(cardStyle.background).toBe(tokens["--atlas-surface"]);
  expect(cardStyle.border).toBe("1px");
  expect(cardStyle.radius).toBe("8px");
  expect(cardStyle.padding).toBe("12px");
  expect(cardStyle.gap).toBe("10px");
  expect(cardStyle.display).toBe("flex");
  expect(cardStyle.direction).toBe("column");
  expect(cardStyle.shadow).toBe("none");

  const title = card.getByRole("link", { name: "E2E ボード 遅延" });
  const titleStyle = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontWeight: style.fontWeight,
      lineClamp: style.webkitLineClamp,
      boxOrient: style.webkitBoxOrient,
      overflow: style.overflow,
    };
  });
  expect(titleStyle).toEqual({
    fontWeight: "500",
    lineClamp: "2",
    boxOrient: "vertical",
    overflow: "hidden",
  });

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
  await expect(todoCard).toContainText("未割当");
  await expect(todoCard).toContainText("子タスク 1 ・ コメント 1");
  // The counts follow the assignee with a gap, never a leading separator.
  await expect(todoCard).not.toContainText("未割当 ・");
  await expect(todoCard.locator("[data-board-subtask-badge]")).toHaveText("子タスク 1");
  await expect(todoCard.locator("[data-board-comment-badge]")).toHaveText("コメント 1");
  await expect(todoCard.locator("[data-board-section-pill]")).toHaveCount(0);
  const todoBadges = todoCard.locator("[data-board-card-badges]");
  await expect(todoBadges).toBeVisible();
  await expect(todoBadges).toContainText("進行中");
  await expect(todoCard.getByText("未割当", { exact: true })).toBeVisible();

  const badgesBox = await todoBadges.boundingBox();
  const todoTitleBox = await todoCard.getByRole("link", { name: "E2E ボード 未着手" }).boundingBox();
  expect(badgesBox && todoTitleBox).toBeTruthy();
  expect(badgesBox!.y + badgesBox!.height).toBeLessThanOrEqual(todoTitleBox!.y + 1);

  const progressCard = page.locator(`[data-board-card="${progressId}"]`);
  await expect(progressCard.getByText(me.name, { exact: true })).toBeVisible();
  const progressBar = progressCard.locator('[data-board-progress="50"]');
  await expect(progressBar).toBeVisible();
  await expect(progressBar).toHaveAttribute("role", "progressbar");
  await expect(progressBar).toHaveAttribute("aria-valuenow", "50");
  const progressStyle = await progressBar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: style.height,
      radius: style.borderRadius,
      position: style.position,
      background: style.backgroundColor,
    };
  });
  expect(progressStyle).toEqual({
    height: "3px",
    radius: "2px",
    position: "static",
    background: tokens["--atlas-surface-muted"],
  });
  const progressFill = progressBar.locator("div");
  const fillStyle = await progressFill.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderRadius, background: style.backgroundColor };
  });
  expect(fillStyle.radius).toBe("2px");
  expect(fillStyle.background).toBe(tokens["--atlas-text"]);
  expect(fillStyle.background).not.toBe(tokens["--atlas-success"]);

  const cardBox = await progressCard.boundingBox();
  const barBox = await progressBar.boundingBox();
  const fillBox = await progressFill.boundingBox();
  const progressTitleBox = await progressCard.getByRole("link", { name: "E2E ボード 進行中" }).boundingBox();
  expect(cardBox && barBox && fillBox && progressTitleBox).toBeTruthy();
  // 12px padding plus the 1px card border on each side.
  expect(barBox!.x - cardBox!.x).toBeCloseTo(13, 0);
  expect(cardBox!.x + cardBox!.width - (barBox!.x + barBox!.width)).toBeCloseTo(13, 0);
  expect(fillBox!.width).toBeCloseTo(barBox!.width / 2, 0);
  expect(barBox!.y).toBeGreaterThan(progressTitleBox!.y + progressTitleBox!.height);
  // The bar sits in the flow, with the meta row below it, not on the card edge.
  expect(cardBox!.y + cardBox!.height - (barBox!.y + barBox!.height)).toBeGreaterThan(20);

  const dueLabel = card.locator("[data-board-due-label]");
  await expect(dueLabel).toHaveClass(/text-danger/);
  await expect(dueLabel).toContainText("期限超過");
  await expect(dueLabel.locator('[data-due-state="overdue"]')).toHaveCount(1);
  const dueBox = await dueLabel.boundingBox();
  const overdueCardBox = await card.boundingBox();
  expect(dueBox && overdueCardBox).toBeTruthy();
  expect(dueBox!.x + dueBox!.width).toBeCloseTo(overdueCardBox!.x + overdueCardBox!.width - 13, 0);
  expect(dueBox!.x).toBeGreaterThan(overdueCardBox!.x + overdueCardBox!.width / 2);

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

  // Hiding the assignee field also hides "未割当"; restoring it brings the label back.
  for (const visible of [false, true]) {
    await page.locator("[data-board-options-open]").click();
    await expect(options).toBeVisible();
    await options.getByRole("checkbox", { name: "担当者", exact: true }).setChecked(visible);
    await options.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(options).toBeHidden();
    await expect(todoCard.getByText("未割当", { exact: true })).toHaveCount(visible ? 1 : 0);
  }

  await expect(page.locator(`[data-board-card="${completeId}"]`).locator("[data-board-progress]")).toHaveCount(0);

  await todoCard.getByRole("button", { name: "未着手（完了にする）", exact: true }).click();
  await expect(todoCard.getByRole("button", { name: "完了（未完了に戻す）", exact: true })).toBeVisible();
  await todoCard.getByRole("button", { name: "完了（未完了に戻す）", exact: true }).click();
  await expect(todoCard.getByRole("button", { name: "未着手（完了にする）", exact: true })).toBeVisible();

  // The heading + opens the same inline composer as the footer link.
  await column.locator("[data-board-column-add]").click();
  const quickName = column.getByLabel("新しいタスク名");
  await expect(quickName).toBeFocused();
  await quickName.press("Escape");
  await expect(quickName).toHaveCount(0);
});

test("board column headings carry a state circle only for state-like status groups", async ({ page }) => {
  const { projectId, section } = await fixture(page);
  const nextWeek = shiftDate(todayISO(), 7);
  const statuses = [
    ["未着手", "todo"],
    ["進行中", "in-progress"],
    ["Done", "complete"],
  ] as const;
  const ids: number[] = [];
  for (const [status] of statuses) {
    const id = await createTask(page, projectId, section.id, {
      name: `E2E 状態列 ${status}`,
      due_on: nextWeek,
    });
    expect((await page.request.patch(`/api/tasks/${id}`, { data: { status } })).status()).toBe(200);
    ids.push(id);
  }
  const customId = await createTask(page, projectId, section.id, {
    name: "E2E 状態列 レビュー待ち",
    due_on: nextWeek,
  });
  expect((await page.request.patch(`/api/tasks/${customId}`, {
    data: { status: "レビュー待ち" },
  })).status()).toBe(200);

  // Section grouping (the default) has no state column, so no icons.
  await page.goto(`/projects/${projectId}?view=board`);
  const sectionColumn = page.locator(`[data-board-column="s${section.id}"]`);
  await expect(sectionColumn).toBeVisible();
  await expect(page.locator("[data-board-column-state]")).toHaveCount(0);

  await page.goto(`/projects/${projectId}?view=board&group=status`);
  for (const [status, state] of statuses) {
    const statusColumn = page.locator(`[data-board-column="${status}"]`);
    await expect(statusColumn).toBeVisible();
    await expect(statusColumn.locator("[data-board-column-header]")).toContainText(status);
    const icon = statusColumn.locator(`[data-board-column-state="${state}"]`);
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("aria-hidden", "true");
  }
  const customColumn = page.locator('[data-board-column="レビュー待ち"]');
  await expect(customColumn).toBeVisible();
  await expect(customColumn.locator("[data-board-column-state]")).toHaveCount(0);

  // Outside section grouping the card names its section quietly above the title.
  const card = page.locator(`[data-board-card="${ids[0]}"]`);
  await expect(card.locator("[data-board-section-pill]")).toHaveText(section.name);
  await expect(card.locator("[data-board-card-badges]")).toContainText("未着手");

  // Completion-date buckets are dates, not a single state, so no icon there.
  await page.goto(`/projects/${projectId}?view=board&group=completed`);
  await expect(page.locator("[data-board-column-state]")).toHaveCount(0);
});
