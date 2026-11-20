import { expect, test, type Locator, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

type Fixture = {
  projectId: number;
  taskIds: number[];
  extraProjectIds: number[];
  userIds: number[];
};

const fixtures = new WeakMap<Page, Fixture>();

test.afterEach(async ({ page }, info) => {
  info.setTimeout(90_000);
  const fixture = fixtures.get(page);
  if (!fixture) return;
  await page.goto("about:blank").catch(() => undefined);
  for (const projectId of fixture.extraProjectIds.toReversed()) {
    expect((await page.request.delete(`/api/projects/${projectId}`)).status()).toBe(200);
  }
  expect((await page.request.delete(`/api/projects/${fixture.projectId}`)).status()).toBe(200);
  for (const userId of fixture.userIds.toReversed()) {
    expect((await page.request.delete(`/api/admin/users/${userId}`)).status()).toBe(200);
  }
});

async function login(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } })).status()).toBe(200);
}

function iso(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function createTasks(page: Page, projectId: number, prefix: string, count = 60) {
  const ids: number[] = [];
  const today = iso(0);
  for (let index = 0; index < count; index += 1) {
    const response = await page.request.post("/api/tasks", {
      data: {
        project_id: projectId,
        name: `${prefix} ${String(index).padStart(2, "0")}`,
        assignee_id: 1,
        start_on: today,
        due_on: today,
      },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json() as { id: number }).id);
  }
  return ids;
}

async function createFixture(page: Page): Promise<Fixture> {
  await login(page);
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `固定ヘッダー ${test.info().testId} ${Date.now()}` },
  });
  expect(project.status()).toBe(201);
  const projectId = (await project.json() as { id: number }).id;
  const fixture: Fixture = { projectId, taskIds: [], extraProjectIds: [], userIds: [] };
  fixtures.set(page, fixture);
  fixture.taskIds = await createTasks(page, projectId, "固定ヘッダー タスク");

  // Initialize the default dashboard, then add enough cards to scroll the
  // content region even at 1440x900.
  expect((await page.request.get(`/api/projects/${projectId}/dashboard/widgets`)).ok()).toBeTruthy();
  for (let index = 0; index < 6; index += 1) {
    const response = await page.request.post(`/api/projects/${projectId}/dashboard/widgets`, {
      data: {
        title: `固定ヘッダー テキスト ${index}`,
        widget_type: "text",
        body: `スクロール確認用のテキスト ${index}\n`.repeat(4),
      },
    });
    expect(response.status()).toBe(201);
  }
  return fixture;
}

async function createExtraProjects(page: Page, fixture: Fixture, count: number) {
  for (let index = 0; index < count; index += 1) {
    const response = await page.request.post("/api/projects", {
      data: { workspace_id: 1, name: `固定ヘッダー 一覧 ${String(index).padStart(2, "0")} ${Date.now()}` },
    });
    expect(response.status()).toBe(201);
    fixture.extraProjectIds.push((await response.json() as { id: number }).id);
  }
}

async function createExtraUsers(page: Page, fixture: Fixture, count: number) {
  for (let index = 0; index < count; index += 1) {
    const response = await page.request.post("/api/admin/users", {
      data: {
        name: `固定ヘッダー メンバー ${index}`,
        email: `fixed-headers-${Date.now()}-${index}@example.com`,
        password: "Atlas-Dev-2026",
        role: "member",
        title: "固定ヘッダー確認",
      },
    });
    expect(response.status()).toBe(201);
    fixture.userIds.push((await response.json() as { id: number }).id);
  }
}

function pageScroll(page: Page) {
  return page.locator("[data-page-scroll]").first();
}

/**
 * Wheel over the content region and prove that only that region moved.
 * `fixed` must identify the last fixed row (a view toolbar, or the page title
 * block for screens without one).
 */
async function expectOnlyContentScrolls(page: Page, fixed: Locator, label: string) {
  const scroll = pageScroll(page);
  await expect(scroll, `${label}: scroll region`).toBeVisible();
  const before = await fixed.boundingBox();
  expect(before, `${label}: fixed row before scrolling`).not.toBeNull();

  const maxScroll = await scroll.evaluate((element) => element.scrollHeight - element.clientHeight);
  expect(maxScroll, `${label}: content must overflow`).toBeGreaterThan(200);

  const box = (await scroll.boundingBox())!;
  expect(box.height, `${label}: scroll region height`).toBeGreaterThan(80);
  const x = box.x + Math.min(box.width - 24, Math.max(24, box.width / 2));
  const y = box.y + Math.min(box.height - 24, Math.max(24, box.height / 2));
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 800);

  await expect.poll(() => scroll.evaluate((element) => element.scrollTop), `${label}: scrollTop`)
    .toBeGreaterThan(0);
  const after = await fixed.boundingBox();
  expect(after, `${label}: fixed row after scrolling`).not.toBeNull();
  expect(Math.round(after!.y), `${label}: fixed row y`).toBe(Math.round(before!.y));
  expect(Math.round(after!.height), `${label}: fixed row height`).toBe(Math.round(before!.height));

  const shell = await page.evaluate(() => ({
    document: document.scrollingElement?.scrollTop ?? 0,
    main: document.querySelector("main")?.scrollTop ?? 0,
  }));
  expect(shell.document, `${label}: document scrollTop`).toBe(0);
  expect(shell.main, `${label}: main scrollTop`).toBe(0);

  // Nothing inside the scroll region (e.g. absolutely positioned sr-only
  // labels) may make the document taller than the viewport, and wheeling
  // over the fixed header must not move the page either.
  const documentOverflow = await page.evaluate(() =>
    (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight);
  expect(documentOverflow, `${label}: document taller than the viewport`).toBeLessThanOrEqual(0);
  const fixedBox = (await fixed.boundingBox())!;
  await page.mouse.move(fixedBox.x + Math.min(40, fixedBox.width / 2), fixedBox.y + fixedBox.height / 2);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0), `${label}: wheel over header`).toBe(0);
  expect(Math.round((await fixed.boundingBox())!.y), `${label}: fixed row y after header wheel`).toBe(Math.round(before!.y));
}

test("project views keep the header and toolbar fixed while content scrolls", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await createFixture(page);
  const toolbar = page.locator("[data-project-view-toolbar]");

  const views = [
    { view: "list", url: `?view=list` },
    { view: "board", url: `?view=board` },
    { view: "timeline", url: `?view=timeline` },
    { view: "calendar", url: `?view=calendar&zoom=week&week=${iso(0)}` },
    { view: "dashboard", url: `?view=dashboard` },
  ] as const;

  for (const entry of views) {
    await page.goto(`/projects/${fixture.projectId}${entry.url}`);
    await expect(page.locator(`[data-project-view="${entry.view}"]`)).toBeVisible();
    await expect(toolbar).toHaveCount(1);
    await expectOnlyContentScrolls(page, toolbar, entry.view);

    if (entry.view === "list") {
      // The column header sticks to the top of the list's scroll region.
      const header = page.locator("[data-list-column-header]");
      await expect(header).toBeVisible();
      const box = await header.boundingBox();
      const scrollBox = await pageScroll(page).boundingBox();
      expect(box).not.toBeNull();
      expect(scrollBox).not.toBeNull();
      expect(box!.y, "list column header stays under the fixed toolbar")
        .toBeGreaterThanOrEqual(scrollBox!.y - 1);
      expect(box!.y, "list column header sticks to the scroll region top")
        .toBeLessThanOrEqual(scrollBox!.y + 2);
    }
  }
});

test("the task pane keeps the same fixed header behavior on the list", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await createFixture(page);
  await page.goto(`/projects/${fixture.projectId}?view=list&task=${fixture.taskIds[0]}`);
  const pane = page.locator("[data-task-pane]");
  await expect(pane).toBeVisible();
  const paneBox = (await pane.boundingBox())!;
  expect(Math.round(paneBox.height), "task pane fills the viewport").toBe(900);
  await expectOnlyContentScrolls(page, page.locator("[data-project-view-toolbar]"), "list with task pane");
  await expect(pane).toBeVisible();
});

test("standalone pages keep the page title and filters fixed", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await createFixture(page);
  await createExtraProjects(page, fixture, 20);
  await createExtraUsers(page, fixture, 18);

  const pages = [
    { label: "home", url: "/" },
    { label: "my-tasks", url: "/my-tasks" },
    { label: "inbox", url: "/inbox?filter=all" },
    { label: "search", url: `/search?q=${encodeURIComponent("固定ヘッダー タスク")}` },
    { label: "portfolio", url: "/portfolio" },
    { label: "admin", url: "/admin" },
  ] as const;

  for (const entry of pages) {
    await page.goto(entry.url);
    const fixed = page.locator("[data-page-fixed]");
    await expect(fixed, `${entry.label}: fixed page header`).toBeVisible();
    await expectOnlyContentScrolls(page, fixed, entry.label);
  }
});

test("375px keeps the list header fixed and avoids horizontal page overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const fixture = await createFixture(page);
  await page.goto(`/projects/${fixture.projectId}?view=list`);
  await expect(page.locator("[data-list-view]")).toBeVisible();
  await expectOnlyContentScrolls(page, page.locator("[data-project-view-toolbar]"), "375px list");

  const widths = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) throw new Error("main is missing");
    return {
      document: document.documentElement.scrollWidth,
      main: main.scrollWidth,
      mainClient: main.clientWidth,
    };
  });
  expect(widths.document, "375px document width").toBeLessThanOrEqual(375);
  expect(widths.main, "375px main scrollWidth").toBeLessThanOrEqual(widths.mainClient);
});
