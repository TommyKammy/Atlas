import { expect, test, type Page } from "@playwright/test";

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

test("timeline end resize keeps the left edge fixed", async ({ page }) => {
  const today = new Date().toLocaleDateString("en-CA");
  const created = await page.request.post("/api/tasks", {
    data: {
      project_id: 1,
      section_id: 2,
      name: `E2E browser resize ${Date.now()}`,
      start_on: today,
      due_on: today,
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: number };

  try {
    await page.goto(`/projects/1?view=timeline&zoom=2`);
    const row = page.locator(`[data-timeline-row="${id}"]`);
    const bar = row.locator(`[data-timeline-bar="${id}"]`);
    await expect(bar).toBeVisible();
    await bar.scrollIntoViewIfNeeded();
    const startHandle = row.locator('[data-timeline-handle="start"]');
    const endHandle = row.locator('[data-timeline-handle="end"]');
    const startBefore = await startHandle.boundingBox();
    const endBefore = await endHandle.boundingBox();
    expect(startBefore).not.toBeNull();
    expect(endBefore).not.toBeNull();

    const handleBox = await endHandle.boundingBox();
    const dragX = handleBox!.x + handleBox!.width / 2;
    const y = handleBox!.y + handleBox!.height / 2;

    const patched = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/tasks/${id}`) &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    );
    await page.mouse.move(dragX, y);
    await page.mouse.down();
    await page.mouse.move(dragX + 24, y, { steps: 8 });
    await page.mouse.up();
    await patched;
    await page.waitForTimeout(400);

    const startAfter = await startHandle.boundingBox();
    const endAfter = await endHandle.boundingBox();
    expect(startAfter).not.toBeNull();
    expect(endAfter).not.toBeNull();
    expect(Math.abs(startAfter!.x - startBefore!.x)).toBeLessThanOrEqual(2);
    expect((endAfter!.x + endAfter!.width) - (endBefore!.x + endBefore!.width)).toBeGreaterThanOrEqual(18);
  } finally {
    await page.request.delete(`/api/tasks/${id}?force=1`);
  }
});

test("timeline start resize keeps the right edge fixed", async ({ page }) => {
  const today = new Date().toLocaleDateString("en-CA");
  const created = await page.request.post("/api/tasks", {
    data: {
      project_id: 1,
      section_id: 2,
      name: `E2E browser start resize ${Date.now()}`,
      start_on: today,
      due_on: today,
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: number };

  try {
    await page.goto(`/projects/1?view=timeline&zoom=2`);
    const row = page.locator(`[data-timeline-row="${id}"]`);
    const bar = row.locator(`[data-timeline-bar="${id}"]`);
    await expect(bar).toBeVisible();
    await bar.scrollIntoViewIfNeeded();
    const startHandle = row.locator('[data-timeline-handle="start"]');
    const endHandle = row.locator('[data-timeline-handle="end"]');
    const startBefore = await startHandle.boundingBox();
    const endBefore = await endHandle.boundingBox();
    expect(startBefore).not.toBeNull();
    expect(endBefore).not.toBeNull();

    const handleBox = await startHandle.boundingBox();
    const dragX = handleBox!.x + handleBox!.width / 2;
    const y = handleBox!.y + handleBox!.height / 2;

    const patched = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/tasks/${id}`) &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    );
    await page.mouse.move(dragX, y);
    await page.mouse.down();
    await page.mouse.move(dragX - 24, y, { steps: 8 });
    await page.mouse.up();
    await patched;
    await page.waitForTimeout(400);

    const startAfter = await startHandle.boundingBox();
    const endAfter = await endHandle.boundingBox();
    expect(startAfter).not.toBeNull();
    expect(endAfter).not.toBeNull();
    expect(Math.abs((endAfter!.x + endAfter!.width) - (endBefore!.x + endBefore!.width))).toBeLessThanOrEqual(2);
    expect(startBefore!.x - startAfter!.x).toBeGreaterThanOrEqual(18);
  } finally {
    await page.request.delete(`/api/tasks/${id}?force=1`);
  }
});

test("task context menu supports arrow navigation and Escape", async ({ page }) => {
  const today = new Date().toLocaleDateString("en-CA");
  const created = await page.request.post("/api/tasks", {
    data: {
      project_id: 1,
      section_id: 2,
      name: `E2E browser menu ${Date.now()}`,
      start_on: today,
      due_on: today,
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: number };

  try {
    await page.goto(`/projects/1?view=timeline&zoom=2`);
    const row = page.locator(`[data-timeline-row="${id}"]`);
    const bar = row.locator(`[data-timeline-bar="${id}"]`);
    await expect(bar).toBeVisible();
    await bar.scrollIntoViewIfNeeded();
    await bar.click({ button: "right" });

    const menu = page.locator("[data-task-context-menu]");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[role="menuitem"]:focus')).toHaveCount(1);

    const first = await menu.locator('[role="menuitem"]').first().textContent();
    await page.keyboard.press("ArrowDown");
    const second = await menu.locator('[role="menuitem"]:focus').textContent();
    expect(second).not.toBe(first);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/tasks/${id}?force=1`);
  }
});
