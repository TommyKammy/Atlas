import { expect, test, type Page } from "@playwright/test";
import { shiftDay } from "../../lib/calendar";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const CSV_HEADER = "セクション,種別,名前,完了,担当者,開始日,期日,進捗,Status,繰返し,コメント";

async function importTasks(page: Page, projectId: number, section: string, date: string, names: string[]) {
  const csv = [CSV_HEADER, ...names.map((name) => `${section},タスク,${name},,,${date},${date},,,,`)].join("\n");
  const response = await page.request.post(`/api/projects/${projectId}/import`, {
    multipart: { file: { name: "timeline.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
  });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ created: names.length, skipped: 0 });
}

test("large timelines reveal offscreen bars for scroll, keyboard focus, and creation", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: "Timeline render window" },
  });
  expect(project.ok()).toBeTruthy();
  const { id: projectId } = await project.json() as { id: number };
  try {
    const today = new Date().toLocaleDateString("en-CA");
    const earlyName = "Early SSR window task";
    const farName = "Far window task";
    await importTasks(page, projectId, "計画中", shiftDay(today, -180), [earlyName]);
    await importTasks(page, projectId, "計画中", today, Array.from({ length: 999 }, (_, i) => `Window A ${i}`));
    await importTasks(page, projectId, "進行中", today, Array.from({ length: 1000 }, (_, i) => `Window B ${i}`));
    await importTasks(page, projectId, "完了", shiftDay(today, 180), [farName]);

    const navigation = await page.goto(`/projects/${projectId}?view=timeline`);
    expect(navigation).not.toBeNull();
    expect(await navigation!.text()).toMatch(/data-timeline-bar="\d+"[^>]*aria-label="Early SSR window task/);
    const timeline = page.locator("[data-timeline]");
    await expect(timeline).toHaveAttribute("data-timeline-windowed", "true");
    const bars = timeline.locator("[data-timeline-bar]");
    await expect.poll(() => bars.count()).toBeGreaterThan(0);
    expect(await bars.count()).toBeLessThan(1000);
    const firstGroup = timeline.locator("[data-timeline-group]").first();
    expect(await firstGroup.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(39_960);

    const farPlaceholder = timeline.getByRole("button", { name: farName, exact: true });
    const farId = await farPlaceholder.getAttribute("data-timeline-focus-placeholder");
    expect(farId).not.toBeNull();
    const farBar = timeline.locator(`[data-timeline-bar="${farId}"]`);
    const pageScroll = page.locator("[data-page-scroll]");
    const scroller = timeline.locator(".timeline-scroll");
    await pageScroll.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect(farBar).toHaveCount(0);
    const wheelTarget = await scroller.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const clip = node.closest("[data-page-scroll]")!.getBoundingClientRect();
      const left = Math.max(0, bounds.left, clip.left);
      const right = Math.min(window.innerWidth, bounds.right, clip.right);
      const top = Math.max(0, bounds.top, clip.top);
      const bottom = Math.min(window.innerHeight, bounds.bottom, clip.bottom);
      if (left >= right || top >= bottom) throw new Error("timeline scroller has no visible wheel target");
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      if (document.elementFromPoint(x, y)?.closest(".timeline-scroll") !== node) {
        throw new Error("wheel point does not hit the timeline scroller");
      }
      return { x, y, remaining: node.scrollWidth - node.clientWidth - node.scrollLeft };
    });
    expect(wheelTarget.remaining).toBeGreaterThan(500);
    await page.mouse.move(wheelTarget.x, wheelTarget.y);
    const wheelDelta = Math.ceil(wheelTarget.remaining / 2);
    await page.mouse.wheel(wheelDelta, 0);
    await page.mouse.wheel(wheelDelta, 0);
    await expect.poll(() => scroller.evaluate((node) => node.scrollWidth - node.clientWidth - node.scrollLeft))
      .toBeLessThan(2);
    await expect(farBar).toBeInViewport();

    await pageScroll.evaluate((node) => { node.scrollTop = 0; });
    await scroller.evaluate((node) => { node.scrollLeft = 0; });
    await expect(farBar).toHaveCount(0);
    const previousPlaceholder = timeline.getByRole("button", { name: "Window B 999", exact: true });
    const previousId = await previousPlaceholder.getAttribute("data-timeline-focus-placeholder");
    expect(previousId).not.toBeNull();
    const previousBar = timeline.locator(`[data-timeline-bar="${previousId}"]`);
    await previousPlaceholder.focus();
    await expect(previousBar).toBeFocused();
    for (let press = 0; press < 4; press++) {
      await page.keyboard.press("Tab");
      const activeId = await page.evaluate(() => document.activeElement?.getAttribute("data-timeline-bar"));
      if (activeId === farId) break;
    }
    await expect(farBar).toBeFocused();
    await expect(farBar).toBeInViewport();
    await expect(previousBar).toHaveCount(0);
    await page.keyboard.press("Shift+Tab");
    await expect(previousBar).toBeFocused();
    await expect(previousBar).toBeInViewport();

    let releaseCreate = () => {};
    let markCreated!: (id: number) => void;
    const created = new Promise<number>((resolve) => { markCreated = resolve; });
    const holdCreate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      const { id } = await response.json() as { id: number };
      markCreated(id);
      await holdCreate;
      await route.fulfill({ response });
    });
    try {
      await timeline.locator("[data-timeline-add]").click();
      const input = page.getByRole("textbox", { name: "新しいタスク名", exact: true });
      await input.fill("Created outside viewport");
      await input.press("Enter");
      const createdId = await created;
      await pageScroll.evaluate((node) => { node.scrollTop = 0; });
      await scroller.evaluate((node) => { node.scrollLeft = 0; });
      releaseCreate();
      const addedBar = page.locator(`[data-timeline-bar="${createdId}"]`);
      await expect(addedBar).toContainText("Created outside viewport");
      await expect(addedBar).toBeInViewport();
      await expect(page.locator("[data-task-pane]")).toHaveCount(0);
    } finally {
      releaseCreate();
    }
  } finally {
    const removed = await page.request.delete(`/api/projects/${projectId}`);
    expect(removed.ok()).toBeTruthy();
  }
});

test("large horizontal jumps mount destination bars before the first drawing frame", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Timeline first-frame jump ${Date.now()}` },
  });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  try {
    const origin = "2026-11-10";
    const anchorSection = await page.request.post("/api/sections", {
      data: { project_id: projectId, name: "Jump anchors" },
    });
    expect(anchorSection.status()).toBe(201);
    const { id: sectionId } = await anchorSection.json() as { id: number };
    const fillerSection = await page.request.post("/api/sections", {
      data: { project_id: projectId, name: "Jump filler" },
    });
    expect(fillerSection.status()).toBe(201);
    const anchorIds: number[] = [];
    for (const [name, date] of [["Early jump anchor", origin], ["Far jump anchor", shiftDay(origin, 180)]]) {
      const created = await page.request.post("/api/tasks", {
        data: { project_id: projectId, section_id: sectionId, name, start_on: date, due_on: date },
      });
      expect(created.status()).toBe(201);
      anchorIds.push((await created.json() as { id: number }).id);
    }
    const [earlyId, farId] = anchorIds;
    // Each import is below the endpoint's 1,000-row cap. These tasks activate
    // windowing while both anchors stay in the first, visible section.
    for (const [offset, count] of [[0, 1000], [1000, 1000], [2000, 1]]) {
      await importTasks(page, projectId, "Jump filler", origin,
        Array.from({ length: count }, (_, i) => `Jump filler ${offset + i}`));
    }
    const saved = await page.request.put("/api/view-state", {
      data: { project_id: projectId, view: "timeline", state: { zoom: 2, critical: true } },
    });
    expect(saved.ok()).toBeTruthy();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${projectId}?view=timeline&from=${origin}`);
    const timeline = page.locator("[data-timeline]");
    await expect(timeline).toHaveAttribute("data-timeline-windowed", "true");
    await expect(timeline).toHaveAttribute("data-timeline-zoom-preset", "week");
    // The native listener below must be registered after the app's hydrated
    // listener, so its first rAF runs after the app's queued window measurement.
    const zoomMenu = page.locator("[data-timeline-zoom-menu]");
    await expect(async () => {
      if (!await zoomMenu.isVisible()) await page.getByRole("button", { name: "ズームレベル: 週", exact: true }).click();
      await expect(zoomMenu).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5_000 });
    await zoomMenu.locator('[data-timeline-zoom-option="週"]').click();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(timeline.locator(`[data-timeline-bar="${earlyId}"]`)).toHaveCount(1);
    await expect(timeline.locator(`[data-timeline-bar="${farId}"]`)).toHaveCount(0);

    for (const [edge, taskId] of [["end", farId], ["start", earlyId], ["end", farId]] as const) {
      const firstFrame = await page.evaluate(({ edge, taskId }) => new Promise<{
        mounted: boolean; intersectsViewport: boolean; scrollDelta: number;
      }>((resolve, reject) => {
        const scroller = document.querySelector<HTMLElement>(".timeline-scroll");
        if (!scroller) throw new Error("Timeline scroller missing");
        const before = scroller.scrollLeft;
        const timeout = window.setTimeout(() => {
          scroller.removeEventListener("scroll", onScroll);
          reject(new Error("Large timeline jump did not produce a scroll event"));
        }, 5_000);
        const onScroll = () => {
          requestAnimationFrame(() => {
            window.clearTimeout(timeout);
            const bar = document.querySelector<HTMLElement>(`[data-timeline-bar="${taskId}"]`);
            const viewport = scroller.getBoundingClientRect();
            const bounds = bar?.getBoundingClientRect();
            resolve({
              mounted: bar !== null,
              intersectsViewport: !!bounds && bounds.right >= viewport.left && bounds.left <= viewport.right,
              scrollDelta: Math.abs(scroller.scrollLeft - before),
            });
          });
        };
        scroller.addEventListener("scroll", onScroll, { once: true });
        scroller.scrollLeft = edge === "end" ? scroller.scrollWidth - scroller.clientWidth : 0;
      }), { edge, taskId });
      // These are captured inside the FIRST scroll-frame callback. An
      // auto-waiting locator here would hide a one-frame blank destination.
      expect(firstFrame.scrollDelta).toBeGreaterThan(420);
      expect(firstFrame.mounted, `${edge} jump task ${taskId} in its first frame`).toBe(true);
      expect(firstFrame.intersectsViewport).toBe(true);
    }
  } finally {
    const removed = await page.request.delete(`/api/projects/${projectId}`);
    expect(removed.ok()).toBeTruthy();
  }
});
