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
    // SSR bars can be visible before their pointer handlers have hydrated.
    const drawer = page.locator("[data-project-customize-drawer]");
    await expect(async () => {
      if (!await drawer.isVisible()) await page.locator("[data-project-customize]").click();
      await expect(drawer).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    await drawer.getByRole("button", { name: "閉じる", exact: true }).click();
    const row = page.locator(`[data-timeline-row="${id}"]`);
    const bar = row.locator(`[data-timeline-bar="${id}"]`);
    await expect(bar).toBeVisible();
    await bar.scrollIntoViewIfNeeded();
    // Single-day bars expose resize handles only while their marker is hovered.
    await bar.hover();
    const startHandle = row.locator('[data-timeline-handle="start"]');
    const endHandle = row.locator('[data-timeline-handle="end"]');
    await expect(endHandle).toHaveCSS("pointer-events", "auto");
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
    expect((await patched).request().postDataJSON()).toHaveProperty("due_on");
    // A successful PATCH can precede the server refresh that replaces the preview.
    await expect(async () => {
      const startAfter = await startHandle.boundingBox();
      const endAfter = await endHandle.boundingBox();
      expect(startAfter).not.toBeNull();
      expect(endAfter).not.toBeNull();
      expect(Math.abs(startAfter!.x - startBefore!.x)).toBeLessThanOrEqual(2);
      expect((endAfter!.x + endAfter!.width) - (endBefore!.x + endBefore!.width)).toBeGreaterThanOrEqual(18);
    }).toPass({ timeout: 5000 });
  } finally {
    await page.request.delete(`/api/tasks/${id}`);
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
    // SSR bars can be visible before their pointer handlers have hydrated.
    const drawer = page.locator("[data-project-customize-drawer]");
    await expect(async () => {
      if (!await drawer.isVisible()) await page.locator("[data-project-customize]").click();
      await expect(drawer).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    await drawer.getByRole("button", { name: "閉じる", exact: true }).click();
    const row = page.locator(`[data-timeline-row="${id}"]`);
    const bar = row.locator(`[data-timeline-bar="${id}"]`);
    await expect(bar).toBeVisible();
    await bar.scrollIntoViewIfNeeded();
    // Single-day bars expose resize handles only while their marker is hovered.
    await bar.hover();
    const startHandle = row.locator('[data-timeline-handle="start"]');
    const endHandle = row.locator('[data-timeline-handle="end"]');
    await expect(endHandle).toHaveCSS("pointer-events", "auto");
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
    expect((await patched).request().postDataJSON()).toHaveProperty("start_on");
    await expect(async () => {
      const startAfter = await startHandle.boundingBox();
      const endAfter = await endHandle.boundingBox();
      expect(startAfter).not.toBeNull();
      expect(endAfter).not.toBeNull();
      expect(Math.abs((endAfter!.x + endAfter!.width) - (endBefore!.x + endBefore!.width))).toBeLessThanOrEqual(2);
      expect(startBefore!.x - startAfter!.x).toBeGreaterThanOrEqual(18);
    }).toPass({ timeout: 5000 });
  } finally {
    await page.request.delete(`/api/tasks/${id}`);
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
    // SSR bars can be visible before their pointer handlers have hydrated.
    const drawer = page.locator("[data-project-customize-drawer]");
    await expect(async () => {
      if (!await drawer.isVisible()) await page.locator("[data-project-customize]").click();
      await expect(drawer).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    await drawer.getByRole("button", { name: "閉じる", exact: true }).click();
    const row = page.locator(`[data-timeline-row="${id}"]`);
    const bar = row.locator(`[data-timeline-bar="${id}"]`);
    await expect(bar).toBeVisible();
    await bar.scrollIntoViewIfNeeded();
    // Single-day bars expose resize handles only while their marker is hovered.
    await bar.hover();
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
    await page.request.delete(`/api/tasks/${id}`);
    await page.request.delete(`/api/tasks/${id}?force=1`);
  }
});

test("timeline sends task details only when the pane is selected", async ({ page }) => {
  const today = new Date().toLocaleDateString("en-CA");
  const created = await page.request.post("/api/tasks", {
    data: { project_id: 1, section_id: 2, name: "Timeline payload task", start_on: today, due_on: today },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: number };
  const marker = `Timeline-detail-only-${id}`;
  try {
    const patch = await page.request.patch(`/api/tasks/${id}`, {
      data: { description_doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: marker }] }] } },
    });
    expect(patch.ok()).toBeTruthy();

    const response = await page.goto("/projects/1?view=timeline");
    expect(response?.ok()).toBeTruthy();
    expect(await response!.text()).not.toContain(marker);
    await expect(page.locator("[data-task-context-menu-host]")).toHaveCount(1);
    await page.locator(`[data-timeline-bar="${id}"]`).click();
    await expect(page.locator("[data-task-pane]")).toContainText(marker);
  } finally {
    await page.request.delete(`/api/tasks/${id}`);
    await page.request.delete(`/api/tasks/${id}?force=1`);
  }
});
