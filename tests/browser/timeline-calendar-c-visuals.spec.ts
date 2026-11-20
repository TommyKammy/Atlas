import { expect, test, type Page } from "@playwright/test";
import { shiftDay } from "../../lib/calendar";
import { todayISO } from "../../lib/dates";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

type Fixture = {
  projectId: number;
  sectionId: number;
  ids: {
    long: number;
    medium: number;
    short: number;
    overdue: number;
    overdueWide: number;
    completed: number;
    criticalOverdue: number;
    criticalNext: number;
    noncritical: number;
    milestone: number;
  };
};

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
}

async function createTask(page: Page, projectId: number, sectionId: number, data: Record<string, unknown>) {
  const response = await page.request.post("/api/tasks", {
    data: { project_id: projectId, section_id: sectionId, ...data },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { id: number }).id;
}

async function patchTask(page: Page, id: number, data: Record<string, unknown>) {
  const response = await page.request.patch(`/api/tasks/${id}`, { data });
  expect(response.status()).toBe(200);
}

async function link(page: Page, from: number, to: number) {
  const response = await page.request.post("/api/dependencies", {
    data: { task_id: to, depends_on_id: from },
  });
  expect(response.status()).toBe(201);
}

async function fixture(page: Page): Promise<Fixture> {
  await login(page);
  const today = todayISO();
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `C timeline calendar ${test.info().testId} ${Date.now()}` },
  });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  const section = await page.request.post("/api/sections", {
    data: { project_id: projectId, name: "工程" },
  });
  expect(section.status()).toBe(201);
  const { id: sectionId } = await section.json() as { id: number };

  const longName = `長い件名の確認用タスク ${"とても長いタスク名を一列に収める".repeat(4)} ${Date.now()}`;
  const long = await createTask(page, projectId, sectionId, {
    name: longName,
    start_on: shiftDay(today, -2),
    due_on: shiftDay(today, 2),
  });
  await patchTask(page, long, { progress: 40 });

  const short = await createTask(page, projectId, sectionId, {
    name: `短いバー ${Date.now()}`,
    start_on: shiftDay(today, 3),
    due_on: shiftDay(today, 3),
  });
  const medium = await createTask(page, projectId, sectionId, {
    name: "設計レビュー",
    start_on: shiftDay(today, -5),
    due_on: shiftDay(today, 0),
  });
  const overdue = await createTask(page, projectId, sectionId, {
    name: `期限超過タスク ${Date.now()}`,
    due_on: shiftDay(today, -1),
  });
  const overdueWide = await createTask(page, projectId, sectionId, {
    name: "リスト表示の実装",
    start_on: shiftDay(today, -6),
    due_on: shiftDay(today, -3),
  });
  await patchTask(page, overdueWide, { progress: 60 });
  const completed = await createTask(page, projectId, sectionId, {
    name: `完了タスク ${Date.now()}`,
    start_on: shiftDay(today, -4),
    due_on: shiftDay(today, -3),
  });
  await patchTask(page, completed, { completed: true });
  const criticalOverdue = await createTask(page, projectId, sectionId, {
    name: `遅延クリティカル ${Date.now()}`,
    start_on: shiftDay(today, -10),
    due_on: shiftDay(today, -3),
  });
  const criticalNext = await createTask(page, projectId, sectionId, {
    name: `後続クリティカル ${Date.now()}`,
    start_on: shiftDay(today, 6),
    due_on: shiftDay(today, 10),
  });
  const noncritical = await createTask(page, projectId, sectionId, {
    name: `非クリティカル ${Date.now()}`,
    start_on: shiftDay(today, -11),
    due_on: shiftDay(today, 1),
  });
  await link(page, criticalOverdue, criticalNext);
  await link(page, criticalOverdue, noncritical);
  const milestone = await createTask(page, projectId, sectionId, {
    name: `マイルストーン ${Date.now()}`,
    start_on: shiftDay(today, -2),
    due_on: shiftDay(today, -2),
    is_milestone: true,
  });
  await page.request.post("/api/comments", {
    data: { task_id: long, body: "C timeline calendar visual fixture" },
  });
  await createTask(page, projectId, sectionId, {
    name: "子タスク",
    parent_task_id: long,
  });

  const saved = await page.request.put("/api/view-state", {
    data: {
      project_id: projectId,
      view: "timeline",
      state: { zoom: 2, critical: true, dependencies: true, weekends: true },
    },
  });
  expect(saved.ok()).toBeTruthy();

  return {
    projectId,
    sectionId,
    ids: { long, medium, short, overdue, overdueWide, completed, criticalOverdue, criticalNext, noncritical, milestone },
  };
}

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

test("timeline canvas, section list and bars follow the quiet workbench treatment", async ({ page }) => {
  const f = await fixture(page);
  const today = todayISO();
  const { long, medium, short, overdue, overdueWide, completed, criticalOverdue, criticalNext, noncritical, milestone } = f.ids;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/projects/${f.projectId}?view=timeline&from=${shiftDay(today, -14)}`);
    await expect(page.locator("[data-timeline]")).toHaveAttribute("data-timeline-zoom-preset", "week");

    const canvas = page.locator("[data-timeline-canvas]");
    await expect(canvas).toHaveCSS("background-color", await tokenColor(page, "--atlas-bg"));

    const weekend = page.locator("[data-timeline-weekend]").first();
    await expect(weekend).toBeVisible();
    await expect(weekend).toHaveCSS("background-color", await tokenColor(page, "--atlas-surface-subtle"));
    // Week zoom drops the per-day hairlines in favour of week/month boundaries.
    await expect(page.locator("[data-timeline-grid]")).toHaveCount(0);
    const boundaryDays = await page.locator("[data-timeline-boundary]").evaluateAll((elements) =>
      elements.map((element) => Number(element.getAttribute("data-timeline-boundary"))),
    );
    const span = Number(await canvas.getAttribute("data-timeline-span"));
    const min = Number(await canvas.getAttribute("data-timeline-min"));
    expect(boundaryDays.length).toBeGreaterThan(0);
    expect(boundaryDays.length).toBeLessThan(span / 3);
    expect(boundaryDays.filter((day) => {
      if (day === min) return false;
      const date = new Date(day * 86_400_000);
      return date.getUTCDay() !== 0 && date.getUTCDate() !== 1;
    })).toEqual([]);
    await expect(page.locator("[data-timeline-boundary]").first()).toHaveCSS(
      "background-color",
      await tokenColor(page, "--atlas-line-subtle"),
    );

    const todayLine = page.locator("[data-timeline-today-line]");
    await expect(todayLine).toHaveCSS("width", "1px");
    await expect(todayLine).toHaveCSS("background-color", await tokenColor(page, "--atlas-accent"));
    const todayLabel = page.locator("[data-timeline-today-label]");
    await expect(todayLabel).toHaveText("今日");
    await expect(todayLabel).toHaveCSS("font-size", "12px");
    await expect(todayLabel).toHaveCSS("color", await tokenColor(page, "--atlas-accent-text"));

    const sectionCount = page.locator("[data-timeline-section-count]").first();
    await expect(sectionCount).toBeVisible();
    await expect(sectionCount).toHaveCSS("font-size", "12px");
    await expect(sectionCount).toHaveCSS("color", await tokenColor(page, "--atlas-text-muted"));
    const section = page.locator("[data-timeline-section-row]").filter({ hasText: "工程" }).first();
    await expect(section).toHaveCSS("font-size", "13px");
    await expect(section).toHaveCSS("font-weight", "700");

    const longBar = page.locator(`[data-timeline-bar="${long}"]`);
    await expect(longBar).toBeVisible();
    await expect(longBar).toHaveCSS("height", "28px");
    await expect(longBar).toHaveCSS("border-radius", "6px");
    await expect(longBar).toHaveCSS("background-color", await tokenColor(page, "--atlas-surface"));
    await expect(longBar).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-line-strong"));
    await expect(longBar).toHaveAttribute("data-timeline-bar-state", "in-progress");
    await expect(longBar).toHaveAttribute("aria-label", /状態: 進行中$/);
    await expect(longBar).toHaveAttribute("title", /進行中/);
    const stateIcon = longBar.locator('[data-task-state-icon="in-progress"]');
    await expect(stateIcon).toHaveCount(1);
    await expect(stateIcon).toHaveAttribute("aria-hidden", "true");
    // A wide bar keeps a long name inside on one ellipsized line.
    await expect(longBar).toHaveCSS("width", "120px");
    const longName = longBar.locator(`[data-timeline-bar-name="${long}"]`);
    await expect(longName).toBeVisible();
    const longNameStyle = await longName.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        height: element.getBoundingClientRect().height,
        overflow: element.scrollWidth > element.clientWidth,
      };
    });
    expect(longNameStyle.whiteSpace).toBe("nowrap");
    expect(longNameStyle.textOverflow).toBe("ellipsis");
    expect(longNameStyle.height).toBeLessThan(24);
    expect(longNameStyle.overflow).toBe(true);
    await expect(longBar.locator(`[data-timeline-progress="40"]`)).toHaveCSS("height", "2px");
    await expect(longBar.locator(`[data-timeline-progress="40"]`)).toHaveCSS(
      "background-color",
      await tokenColor(page, "--atlas-text"),
    );

    // A name that does fit stays inside on one ellipsized line.
    const mediumBar = page.locator(`[data-timeline-bar="${medium}"]`);
    const mediumName = mediumBar.locator(`[data-timeline-bar-name="${medium}"]`);
    await expect(mediumName).toBeVisible();
    const mediumNameStyle = await mediumName.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        height: element.getBoundingClientRect().height,
      };
    });
    expect(mediumNameStyle.whiteSpace).toBe("nowrap");
    expect(mediumNameStyle.textOverflow).toBe("ellipsis");
    expect(mediumNameStyle.height).toBeLessThan(24);

    const shortLabel = page.locator(`[data-timeline-bar-label="${short}"]`);
    await expect(shortLabel).toBeVisible();
    await expect(shortLabel).toHaveCSS("color", await tokenColor(page, "--atlas-text-secondary"));
    await expect(shortLabel).toHaveCSS("white-space", "nowrap");
    const shortLabelBox = await shortLabel.boundingBox();
    expect(shortLabelBox).not.toBeNull();
    expect(shortLabelBox!.height).toBeLessThan(24);
    await expect(shortLabel.locator('[data-task-state-icon="todo"]')).toHaveCount(1);
    await expect(page.locator("[data-timeline] .line-clamp-2")).toHaveCount(0);

    const overdueBar = page.locator(`[data-timeline-bar="${overdue}"]`);
    await expect(overdueBar).toHaveAttribute("data-timeline-bar-state", "overdue");
    await expect(overdueBar).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-danger-line"));
    await expect(overdueBar).toHaveCSS("background-color", await tokenColor(page, "--atlas-surface"));
    // The overdue state circle replaces the redundant due triangle.
    await expect(overdueBar.locator('[data-due-state="overdue"]')).toHaveCount(0);
    await expect(overdueBar.locator('[data-task-state-icon="overdue"]')).toHaveCount(1);
    await expect(overdueBar.locator(".sr-only")).toContainText("期限超過");
    await expect(overdueBar).toHaveAttribute("aria-label", /状態: 遅延・期限超過$/);

    // A 4-day bar (96px) cannot fit the name beside its state circle, so the
    // same external-label rule applies as for a short bar.
    const overdueWideBar = page.locator(`[data-timeline-bar="${overdueWide}"]`);
    await expect(overdueWideBar).toHaveCSS("width", "96px");
    await expect(overdueWideBar.locator(`[data-timeline-bar-name="${overdueWide}"]`)).toHaveCount(0);
    await expect(overdueWideBar.locator('[data-task-state-icon="overdue"]')).toHaveCount(1);
    await expect(overdueWideBar.locator('[data-due-state="overdue"]')).toHaveCount(0);
    const overdueWideLabel = page.locator(`[data-timeline-bar-label="${overdueWide}"]`);
    await expect(overdueWideLabel).toBeVisible();
    await expect(overdueWideLabel).toHaveCSS("color", await tokenColor(page, "--atlas-text-secondary"));
    await expect(overdueWideLabel).toHaveCSS("white-space", "nowrap");
    const overdueWideLabelBox = await overdueWideLabel.boundingBox();
    expect(overdueWideLabelBox).not.toBeNull();
    expect(overdueWideLabelBox!.height).toBeLessThan(24);
    await expect(overdueWideBar).toHaveAttribute("aria-label", /状態: 遅延・期限超過$/);

    const completedBar = page.locator(`[data-timeline-bar="${completed}"]`);
    await expect(completedBar).toHaveAttribute("data-timeline-bar-state", "complete");
    await expect(completedBar).toHaveCSS("background-color", await tokenColor(page, "--atlas-surface-subtle"));
    const completedLabel = page.locator(`[data-timeline-bar-label="${completed}"]`);
    await expect(completedLabel).toHaveCSS("color", await tokenColor(page, "--atlas-text-muted"));
    await expect(completedLabel).toHaveCSS("text-decoration-line", "line-through");

    // A critical and overdue bar shows both signals: accent ring + danger border.
    const criticalBar = page.locator(`[data-timeline-bar="${criticalOverdue}"]`);
    await expect(criticalBar).toHaveAttribute("data-timeline-critical-task", "true");
    await expect(criticalBar).toHaveAttribute("data-timeline-bar-state", "overdue");
    await expect(criticalBar).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-danger-line"));
    await expect(criticalBar).toHaveAttribute("aria-label", /【クリティカルパス】/);
    await expect(criticalBar).toHaveAttribute("title", /クリティカルパス上/);
    const shadow = await criticalBar.evaluate((element) => getComputedStyle(element).boxShadow);
    expect(shadow).toContain(await tokenColor(page, "--atlas-accent"));

    const criticalEdge = page.locator(`[data-timeline-dependency="${criticalOverdue}-${criticalNext}"]`);
    await expect(criticalEdge).toHaveAttribute("data-timeline-dependency-critical", "true");
    await expect(criticalEdge.locator("path").first()).toHaveCSS("stroke", await tokenColor(page, "--atlas-accent"));
    const normalEdge = page.locator(`[data-timeline-dependency="${criticalOverdue}-${noncritical}"]`);
    await expect(normalEdge).not.toHaveAttribute("data-timeline-dependency-critical", "true");
    await expect(normalEdge.locator("path").first()).toHaveCSS("stroke", await tokenColor(page, "--atlas-line-strong"));

    const milestoneBar = page.locator(`[data-timeline-bar="${milestone}"]`);
    await expect(milestoneBar.locator("[data-task-milestone]")).toHaveCount(1);
    await expect(milestoneBar.locator("[data-task-milestone]")).toHaveCSS(
      "color",
      await tokenColor(page, "--atlas-text"),
    );
    // Milestones use the diamond, never a four-state circle. Because there is
    // no circle, the overdue triangle remains in the one-line outside label.
    await expect(milestoneBar.locator("[data-task-state-icon]")).toHaveCount(0);
    const milestoneLabel = page.locator(`[data-timeline-bar-label="${milestone}"]`);
    await expect(milestoneLabel).toBeVisible();
    await expect(milestoneLabel).toHaveCSS("white-space", "nowrap");
    const milestoneLabelBox = await milestoneLabel.boundingBox();
    expect(milestoneLabelBox).not.toBeNull();
    expect(milestoneLabelBox!.height).toBeLessThan(24);
    await expect(milestoneLabel.locator("[data-task-state-icon]")).toHaveCount(0);
    await expect(milestoneLabel.locator('[data-due-state="overdue"]')).toHaveCount(1);
    await expect(milestoneLabel.locator(".sr-only")).toContainText("期限超過");
    await expect(page.locator("[data-timeline-critical-legend]")).toHaveCSS(
      "border-top-color",
      await tokenColor(page, "--atlas-accent"),
    );

    // At month zoom a multi-day bar keeps its name inside, preserving the
    // previous lane packing behavior.
    await page.getByRole("button", { name: /^ズームレベル:/ }).click();
    await page.locator('[data-timeline-zoom-option="月"]').click();
    await expect(page.locator("[data-timeline]")).toHaveAttribute("data-timeline-zoom-preset", "month");
    await expect(
      page.locator(`[data-timeline-bar="${medium}"] [data-timeline-bar-name="${medium}"]`),
    ).toHaveCount(1);
    await expect(page.locator(`[data-timeline-bar-label="${medium}"]`)).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/projects/${f.projectId}`);
  }
});

test("calendar grid and task bars use quiet lines, weekend surfaces and named states", async ({ page }) => {
  const f = await fixture(page);
  const today = todayISO();
  const { long, overdue, completed, milestone } = f.ids;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/projects/${f.projectId}?view=calendar&month=${today.slice(0, 7)}`);
    await expect(page.locator("[data-calendar-view]")).toBeVisible();

    const grid = page.locator("[data-calendar-grid]");
    await expect(grid).toHaveCSS("border-left-color", await tokenColor(page, "--atlas-line-subtle"));
    const weekday = page.locator("[data-calendar-weekday-row] [data-calendar-weekday]").first();
    await expect(weekday).toHaveCSS("font-size", "12px");
    await expect(weekday).toHaveCSS("color", await tokenColor(page, "--atlas-text-muted"));

    const weekendCell = page.locator('[data-calendar-day][data-calendar-weekend="true"]').first();
    await expect(weekendCell).toHaveCSS("background-color", await tokenColor(page, "--atlas-surface-subtle"));
    const weekdayCell = page.locator("[data-calendar-day]:not([data-calendar-weekend])").first();
    await expect(weekdayCell).not.toHaveCSS("background-color", await tokenColor(page, "--atlas-surface-subtle"));

    const todayHeader = page.locator(`[data-day-header="${today}"] span`).first();
    await expect(todayHeader).toHaveCSS("background-color", await tokenColor(page, "--atlas-accent"));
    await expect(todayHeader).toHaveCSS("color", await tokenColor(page, "--atlas-on-accent"));

    const outOfMonth = page.locator("[data-day-header]").evaluateAll((elements, month) => {
      const match = elements.find((element) => {
        const iso = element.getAttribute("data-day-header") ?? "";
        return iso.slice(0, 7) !== month && element.querySelector("span");
      });
      return match?.querySelector("span") ? getComputedStyle(match.querySelector("span")!).color : null;
    }, today.slice(0, 7));
    expect(await outOfMonth).toBe(await tokenColor(page, "--atlas-text-subtle"));

    const longBar = page.locator(`[data-calendar-multiday="${long}"]`).first();
    await expect(longBar).toBeVisible();
    await expect(longBar).toHaveCSS("height", "26px");
    // A bar that crosses a week boundary is squared off on the continuing side,
    // so check the 6px radius on each end that does not continue.
    const continues = (await longBar.getAttribute("data-calendar-continues")) ?? "none";
    const continuesLeft = continues === "left" || continues === "both";
    const continuesRight = continues === "right" || continues === "both";
    await expect(longBar).toHaveCSS("border-top-left-radius", continuesLeft ? "0px" : "6px");
    await expect(longBar).toHaveCSS("border-top-right-radius", continuesRight ? "0px" : "6px");
    await expect(longBar).toHaveCSS("background-color", await tokenColor(page, "--atlas-surface"));
    await expect(longBar).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-line"));
    await expect(longBar.locator("[data-completion-state]")).toHaveAttribute("data-completion-state", "in-progress");
    const barName = longBar.locator('span[dir="auto"]').first();
    await expect(barName).toHaveCSS("white-space", "nowrap");
    await expect(barName).toHaveCSS("text-overflow", "ellipsis");
    await expect(longBar.locator('[aria-label="子タスク 1"]')).toHaveCount(1);
    await expect(longBar.locator('[aria-label="コメント 1"]')).toHaveCount(1);

    const overdueBar = page.locator(`[data-calendar-single="${overdue}"]`).first();
    await expect(overdueBar).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-danger-line"));
    // The completion circle already shows overdue; the triangle is not repeated.
    await expect(overdueBar.locator('[data-due-state="overdue"]')).toHaveCount(0);
    await expect(overdueBar.locator('[data-completion-state="overdue"]')).toHaveCount(1);
    await expect(overdueBar.locator(".sr-only")).toContainText("期限超過");
    const toggled = page.waitForResponse(
      (response) => response.url().includes(`/api/tasks/${overdue}`) &&
        response.request().method() === "PATCH" && response.status() === 200,
    );
    await overdueBar.locator("[data-completion-state]").click();
    await toggled;
    await expect(overdueBar.locator("[data-completion-state]")).toHaveAttribute("data-completion-state", "complete");

    // A milestone has no four-state circle; if overdue, the triangle is the
    // fallback state cue.
    const milestoneBar = page.locator(`[data-calendar-single="${milestone}"]`).first();
    await expect(milestoneBar).toBeVisible();
    await expect(milestoneBar).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-danger-line"));
    await expect(milestoneBar.locator("[data-task-milestone]")).toHaveCount(1);
    await expect(milestoneBar.locator("[data-completion-state]")).toHaveCount(0);
    await expect(milestoneBar.locator('[data-due-state="overdue"]')).toHaveCount(1);
    await expect(milestoneBar.locator(".sr-only")).toContainText("期限超過");

    const completedBar = page.locator(`[data-calendar-multiday="${completed}"]`).first();
    await expect(completedBar).toHaveCSS("background-color", await tokenColor(page, "--atlas-surface-subtle"));
    const completedName = completedBar.locator('span[dir="auto"]').first();
    await expect(completedName).toHaveCSS("color", await tokenColor(page, "--atlas-text-muted"));
    await expect(completedName).toHaveCSS("text-decoration-line", "line-through");
    await expect(completedBar.locator("[data-completion-state]")).toHaveAttribute("data-completion-state", "complete");
  } finally {
    await page.request.delete(`/api/projects/${f.projectId}`);
  }
});
