import { expect, test, type Locator, type Page } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const projects = new WeakMap<Page, number>();

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `Completion icon ${test.info().testId} ${Date.now()}` },
  });
  expect(project.status()).toBe(201);
  const { id } = await project.json() as { id: number };
  projects.set(page, id);
  const task = await page.request.post("/api/tasks", { data: { project_id: id, name: "完了アイコンの大きさ" } });
  expect(task.status()).toBe(201);
});

test.afterEach(async ({ page }) => {
  const id = projects.get(page);
  if (!id) return;
  await page.goto("about:blank");
  await page.request.delete(`/api/projects/${id}`);
});

/** Rendered circle diameter and stroke width in CSS pixels. */
async function circleMetrics(toggle: Locator) {
  return toggle.evaluate((button) => {
    const svg = button.querySelector("svg")!;
    const circle = svg.querySelector("circle")!;
    const scale = svg.getBoundingClientRect().width / 24;
    return {
      button: button.getBoundingClientRect().width,
      diameter: circle.getBoundingClientRect().width,
      stroke: parseFloat(getComputedStyle(svg).strokeWidth) * scale,
    };
  });
}

// Asana's list completion circle is about 16px across with a ~1.5px line;
// the list and board state circle matches it inside an 18px button.
for (const view of ["list", "board"] as const) {
  test(`${view}: the completion circle is about 16px across with a 1.5px line`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${projects.get(page)}?view=${view}`);
    const toggle = page.locator("[data-completion-state]").first();
    await expect(toggle).toBeVisible();
    const metrics = await circleMetrics(toggle);
    expect(Math.round(metrics.button)).toBe(18);
    expect(metrics.diameter).toBeGreaterThanOrEqual(15);
    expect(metrics.diameter).toBeLessThanOrEqual(16.5);
    expect(metrics.stroke).toBeCloseTo(1.5, 1);
  });
}

test("list: a completed task shows a filled green circle with a white check and a grey name", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = projects.get(page)!;
  const created = await page.request.post("/api/tasks", { data: { project_id: projectId, name: "完了済みのタスク" } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: number };
  expect((await page.request.patch(`/api/tasks/${id}`, { data: { completed: true } })).status()).toBe(200);

  await page.goto(`/projects/${projectId}?view=list`);
  const row = page.locator(`[data-list-row="${id}"]`);
  const toggle = row.locator('[data-completion-state="complete"]');
  await expect(toggle).toBeVisible();
  const token = (name: string) => page.evaluate((variable) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${variable})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
  const icon = await toggle.evaluate((button) => ({
    fill: getComputedStyle(button.querySelector("circle")!).fill,
    check: getComputedStyle(button.querySelector("path")!).stroke,
  }));
  expect(icon.fill).toBe(await token("--atlas-success-strong"));
  expect(icon.check).toBe(await token("--atlas-on-strong"));
  await expect(row.locator(`[data-list-task-name="${id}"]`)).toHaveCSS("color", await token("--atlas-text-muted"));
});
