import { expect, test, type Locator, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const projectsToRemove = new WeakMap<Page, number>();
const CSV_HEADER = "セクション,種別,名前,完了,担当者,開始日,期日,進捗,Status,繰返し,コメント";

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

async function fixture(page: Page, withDependency: boolean) {
  const login = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Dependency window ${test.info().testId} ${Date.now()}` },
  });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  projectsToRemove.set(page, projectId);
  const section = await page.request.post("/api/sections", { data: { project_id: projectId, name: "Dependency anchors" } });
  expect(section.status()).toBe(201);
  const { id: sectionId } = await section.json() as { id: number };
  const filler = await page.request.post("/api/sections", { data: { project_id: projectId, name: "Window filler" } });
  expect(filler.status()).toBe(201);
  const tasks: number[] = [];
  // Overlap the dates to produce a connector with an exposed vertical segment
  // between the two lanes, away from bars and their pointer handlers.
  for (const [name, start_on, due_on] of [
    ["Dependency source", "2026-12-10", "2026-12-14"],
    ["Dependency target", "2026-12-12", "2026-12-16"],
  ]) {
    const response = await page.request.post("/api/tasks", { data: { project_id: projectId, section_id: sectionId, name, start_on, due_on } });
    expect(response.status()).toBe(201);
    tasks.push((await response.json() as { id: number }).id);
  }
  const [sourceId, targetId] = tasks;
  const rows = [
    ...Array.from({ length: 2000 }, (_, i) => `Window filler,タスク,Dependency filler ${i},,,2026-11-10,2026-11-10,,,,`),
    "Window filler,タスク,Far dependency filler,,,2027-03-10,2027-03-10,,,,",
  ];
  // The import endpoint accepts at most 1,000 rows per request.
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const batch = rows.slice(offset, offset + 1000);
    const csv = [CSV_HEADER, ...batch].join("\n");
    const imported = await page.request.post(`/api/projects/${projectId}/import`, {
      multipart: { file: { name: "dependency-window.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
    });
    expect(imported.ok()).toBeTruthy();
    expect(await imported.json()).toMatchObject({ created: batch.length, skipped: 0 });
  }
  if (withDependency) {
    const created = await page.request.post("/api/dependencies", { data: { task_id: targetId, depends_on_id: sourceId } });
    expect(created.status()).toBe(201);
  }
  // Zoom comes from saved state, rather than an ignored zoom query parameter.
  const saved = await page.request.put("/api/view-state", {
    data: { project_id: projectId, view: "timeline", state: { zoom: 2, dependencies: true, critical: true } },
  });
  expect(saved.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${projectId}?view=timeline&from=2026-11-10`);
  const timeline = page.locator("[data-timeline]");
  await expect(timeline).toHaveAttribute("data-timeline-windowed", "true");
  await expect(timeline).toHaveAttribute("data-timeline-zoom-preset", "week");
  await expect(timeline).toHaveAttribute("data-timeline-dependencies", "true");
  // Prove hydration before causing a viewport-only render. Opening this menu
  // is idempotent, so a pre-hydration click can be retried safely.
  const zoomMenu = page.locator("[data-timeline-zoom-menu]");
  await expect(async () => {
    if (!await zoomMenu.isVisible()) await page.getByRole("button", { name: "ズームレベル: 週", exact: true }).click();
    await expect(zoomMenu).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5_000 });
  await zoomMenu.locator('[data-timeline-zoom-option="週"]').click();
  const scroller = timeline.locator(".timeline-scroll");
  await scroller.evaluate((element) => { element.scrollLeft = 600; });
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(600);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const source = page.locator(`[data-timeline-bar="${sourceId}"]`);
  const target = page.locator(`[data-timeline-bar="${targetId}"]`);
  await expect(source).toBeInViewport();
  await expect(target).toBeInViewport();
  return { sourceId, targetId, source, target, key: `${sourceId}-${targetId}` };
}

async function strokePoint(hit: Locator) {
  // A bent SVG path's bounding-box center may be empty space or covered by a
  // bar. Choose a real, exposed point on its stroke for a native pointer hover.
  return await hit.evaluate((element) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Dependency path has no screen transform");
    const length = path.getTotalLength();
    for (let i = 1; i < 100; i++) {
      const local = path.getPointAtLength(length * i / 100);
      const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      if (document.elementFromPoint(point.x, point.y) === path) return { x: point.x, y: point.y };
    }
    throw new Error("Dependency has no exposed pointer hit point");
  });
}

test("dependency hover, keyboard focus and deletion work after a viewport-only horizontal scroll", async ({ page }) => {
  const f = await fixture(page, true);
  const hit = page.locator(`[data-timeline-dependency-hit="${f.key}"]`);
  const remove = page.locator(`[data-timeline-dependency-delete="${f.key}"]`);
  const point = await strokePoint(hit);
  await page.mouse.move(point.x, point.y);
  await expect(remove).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(remove).toBeHidden();
  await hit.focus();
  await expect(remove).toBeVisible();
  const deleted = page.waitForResponse((response) => response.url().includes("/api/dependencies?") && response.request().method() === "DELETE");
  await remove.click();
  expect((await deleted).status()).toBe(200);
  await expect(page.locator(`[data-timeline-dependency="${f.key}"]`)).toHaveCount(0);
});

test("dependency draft movement, creation refresh and zoom update the memoized layer", async ({ page }) => {
  const f = await fixture(page, false);
  await f.source.hover();
  const handle = page.locator(`[data-timeline-dependency-handle="${f.sourceId}"][data-timeline-dependency-direction="dependent"]`);
  await expect(handle).toHaveCSS("opacity", "1");
  const handleBox = await handle.boundingBox();
  const targetBox = await f.target.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const target = { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 };
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  const draft = page.locator("[data-timeline-dependency-draft]");
  await expect(draft).toHaveCount(1);
  const initial = await draft.getAttribute("d");
  await page.mouse.move(target.x + 40, target.y - 20, { steps: 3 });
  await expect(draft).not.toHaveAttribute("d", initial!);
  const intermediate = await draft.getAttribute("d");
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await expect(draft).not.toHaveAttribute("d", intermediate!);
  await expect(f.target).toHaveAttribute("data-timeline-dependency-target", "true");
  const created = page.waitForResponse((response) => response.url().endsWith("/api/dependencies") && response.request().method() === "POST");
  await page.mouse.up();
  expect((await created).status()).toBe(201);
  await expect(draft).toHaveCount(0);
  const shape = page.locator(`[data-timeline-dependency-hit="${f.key}"]`);
  await expect(shape).toHaveCount(1);
  const beforeZoom = await shape.getAttribute("d");
  await page.getByRole("button", { name: "ズームレベル: 週", exact: true }).click();
  await page.locator('[data-timeline-zoom-option="月"]').click();
  await expect(page.locator("[data-timeline]")).toHaveAttribute("data-timeline-zoom-preset", "month");
  await expect(shape).not.toHaveAttribute("d", beforeZoom!);
});
