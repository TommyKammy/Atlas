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
    const main = page.locator("main");
    const scroller = timeline.locator(".timeline-scroll");
    await main.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect(farBar).toHaveCount(0);
    const wheelTarget = await scroller.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const clip = node.closest("main")!.getBoundingClientRect();
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

    await main.evaluate((node) => { node.scrollTop = 0; });
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

    await timeline.locator("[data-timeline-add]").click();
    const input = timeline.getByRole("textbox", { name: "新しいタスク名" });
    await input.fill("Created outside viewport");
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
      await input.press("Enter");
      const createdId = await created;
      await main.evaluate((node) => { node.scrollTop = 0; });
      await scroller.evaluate((node) => { node.scrollLeft = 0; });
      releaseCreate();
      await expect(timeline.locator(`[data-timeline-bar="${createdId}"]`)).toBeInViewport();
    } finally {
      releaseCreate();
    }
  } finally {
    const removed = await page.request.delete(`/api/projects/${projectId}`);
    expect(removed.ok()).toBeTruthy();
  }
});
