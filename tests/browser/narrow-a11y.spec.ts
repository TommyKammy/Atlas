import { expect, test, type Locator, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const THEMES = ["light", "dark"] as const;

const projects = new WeakMap<Page, number>();
const portfolios = new WeakMap<Page, number>();

test.afterEach(async ({ page }, info) => {
  const portfolioId = portfolios.get(page);
  if (portfolioId) {
    await page.goto("about:blank");
    const response = await page.request.delete(`/api/portfolios/${portfolioId}`);
    if (info.status === info.expectedStatus) expect(response.ok()).toBeTruthy();
  }
  const projectId = projects.get(page);
  if (!projectId) return;
  await page.goto("about:blank");
  const response = await page.request.delete(`/api/projects/${projectId}`);
  if (info.status === info.expectedStatus) expect(response.ok()).toBeTruthy();
});

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(response.status()).toBe(200);
}

function iso(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function fixture(page: Page) {
  await login(page);
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `狭幅アクセシビリティ ${Date.now()}` },
  });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  projects.set(page, projectId);
  const taskIds: number[] = [];
  for (const [index, name] of ["要件定義レビュー", "ボード確認", "タイムライン確認"].entries()) {
    const task = await page.request.post("/api/tasks", {
      data: {
        project_id: projectId,
        name: `${name} ${index + 1}`,
        assignee_id: 1,
        start_on: iso(index - 1),
        due_on: iso(index + 2),
      },
    });
    expect(task.status()).toBe(201);
    taskIds.push((await task.json() as { id: number }).id);
  }
  const subtask = await page.request.post("/api/tasks", {
    data: { project_id: projectId, name: "サブタスク確認", parent_task_id: taskIds[0] },
  });
  expect(subtask.status()).toBe(201);
  const comment = await page.request.post(`/api/comments?task_id=${taskIds[0]}`, {
    data: { body: "狭幅テストのコメント" },
  });
  expect(comment.status()).toBe(201);
  return { projectId, taskIds };
}

async function open(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.waitForTimeout(200);
}

async function useTheme(page: Page, theme: "light" | "dark") {
  const baseURL = test.info().project.use.baseURL;
  expect(baseURL).toBeTruthy();
  await page.context().addCookies([{ name: "atlas_theme", value: theme, url: baseURL! }]);
}

/** Move the browser into keyboard modality so :focus-visible applies. */
async function keyboardModality(page: Page) {
  await page.keyboard.press("Tab");
}

async function focusWithKeyboard(page: Page, locator: Locator) {
  await keyboardModality(page);
  await locator.focus();
  await expect(locator).toBeFocused();
  // Let opacity/visibility transitions settle.
  await page.waitForTimeout(180);
}

async function ringStyles(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      boxShadow: style.boxShadow,
    };
  });
}

for (const theme of THEMES) {
  test(`375px: pages do not scroll horizontally (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const { projectId, taskIds } = await fixture(page);
    const portfolio = await page.request.post("/api/portfolios", {
      data: { name: `狭幅ポートフォリオ ${Date.now()}` },
    });
    expect(portfolio.status()).toBe(201);
    portfolios.set(page, (await portfolio.json() as { id: number }).id);
    await page.setViewportSize({ width: 375, height: 812 });
    await useTheme(page, theme);
    const pages: Array<[string, string]> = [
      ["home", "/"],
      ["my-tasks", "/my-tasks"],
      ["inbox", "/inbox"],
      ["search", "/search?q=%E8%A6%81%E4%BB%B6"],
      ["project-list", `/projects/${projectId}?view=list`],
      ["project-board", `/projects/${projectId}?view=board`],
      ["project-timeline", `/projects/${projectId}?view=timeline`],
      ["project-calendar", `/projects/${projectId}?view=calendar`],
      ["project-dashboard", `/projects/${projectId}?view=dashboard`],
      ["project-task", `/projects/${projectId}?view=list&task=${taskIds[0]}`],
      ["portfolio", "/portfolio"],
    ];
    for (const [name, route] of pages) {
      await open(page, route);
      if (name === "portfolio") {
        // The project picker grows with the longest option name; it must stay
        // inside the viewport instead of widening the page.
        const picker = page.locator("[data-portfolio-workspace] select").first();
        await expect(picker).toBeVisible();
        const box = await picker.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width, "portfolio project picker").toBeLessThanOrEqual(375);
      }
      const widths = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) throw new Error("main is missing");
        return {
          document: document.documentElement.scrollWidth,
          main: main.scrollWidth,
          mainClient: main.clientWidth,
        };
      });
      expect(widths.document, `${name} widened the document`).toBeLessThanOrEqual(375);
      expect(widths.main, `${name} widened the page's main scroll area`).toBeLessThanOrEqual(widths.mainClient);
    }
  });
}

test("375px: mobile navigation and project tabs leave room for the focus ring", async ({ page }) => {
  const { projectId } = await fixture(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "/");

  const mobileNav = page.getByRole("navigation", { name: "モバイルナビゲーション" });
  const mobileLink = mobileNav.getByRole("link", { name: "ホーム", exact: true });
  await focusWithKeyboard(page, mobileLink);
  const mobileGap = await mobileLink.evaluate((element) => {
    const link = element.getBoundingClientRect();
    const nav = element.parentElement!.getBoundingClientRect();
    return { left: link.left - nav.left, top: link.top - nav.top };
  });
  expect(mobileGap.left).toBeGreaterThanOrEqual(4);
  expect(mobileGap.top).toBeGreaterThanOrEqual(4);

  await open(page, `/projects/${projectId}?view=list`);
  const tabs = page.locator("nav[data-project-tabs]");
  const tab = tabs.getByRole("link", { name: "リスト", exact: true });
  await focusWithKeyboard(page, tab);
  const tabGap = await tab.evaluate((element) => {
    const link = element.getBoundingClientRect();
    const nav = element.closest("nav")!.getBoundingClientRect();
    return { top: link.top - nav.top, bottom: nav.bottom - link.bottom };
  });
  expect(tabGap.top).toBeGreaterThanOrEqual(4);
  expect(tabGap.bottom).toBeGreaterThanOrEqual(4);
});

test("hover-only list and timeline controls become visible when focused", async ({ page }) => {
  test.setTimeout(90_000);
  const { projectId, taskIds } = await fixture(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, `/projects/${projectId}?view=list`);

  // The column menu is hidden until the header is hovered.
  const columnMenu = page.locator('[data-list-view] button[title="列メニュー"]').first();
  await focusWithKeyboard(page, columnMenu);
  expect(await columnMenu.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");

  // The row action stays hidden until the row receives focus; it is then
  // reachable by keyboard and carries a descriptive name. Narrow rows hide
  // the trailing action columns, so exercise this at the desktop width.
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, `/projects/${projectId}?view=list`);
  const row = page.locator(`[data-list-row="${taskIds[0]}"]`);
  await row.focus();
  const rowDelete = row.locator('button[title="削除"]');
  await expect(rowDelete).toBeVisible();
  await expect(rowDelete).toHaveAccessibleName(new RegExp("を削除"));
  await rowDelete.focus();
  await expect(rowDelete).toBeFocused();
  const deleteRing = await ringStyles(rowDelete);
  expect(deleteRing.boxShadow !== "none" || (deleteRing.outlineStyle !== "none" && deleteRing.outlineWidth > 0)).toBeTruthy();

  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, `/projects/${projectId}?view=timeline`);
  const handle = page.locator("[data-timeline-dependency-handle]").first();
  await focusWithKeyboard(page, handle);
  expect(await handle.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  const handleRing = await ringStyles(handle);
  expect(handleRing.boxShadow !== "none" || (handleRing.outlineStyle !== "none" && handleRing.outlineWidth > 0)).toBeTruthy();
});

test("task pane comment actions become visible when focused", async ({ page }) => {
  test.setTimeout(90_000);
  const { projectId, taskIds } = await fixture(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, `/projects/${projectId}?view=list&task=${taskIds[0]}`);

  const edit = page.locator("[data-comment-edit]").first();
  await focusWithKeyboard(page, edit);
  const actions = edit.locator("..");
  expect(await actions.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  const editRing = await ringStyles(edit);
  expect(editRing.boxShadow !== "none" || (editRing.outlineStyle !== "none" && editRing.outlineWidth > 0)).toBeTruthy();
});
