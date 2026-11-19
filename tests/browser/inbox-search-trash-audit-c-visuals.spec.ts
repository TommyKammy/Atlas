import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

type Fixture = {
  prefix: string;
  userId: number;
  projectId: number;
  taskId: number;
  trashTaskId: number;
  commentId: number;
  context: BrowserContext;
};
const fixtures = new WeakMap<Page, Fixture>();

test.afterEach(async ({ page }, info) => {
  info.setTimeout(20_000);
  const f = fixtures.get(page);
  if (!f) return;
  await f.context.close();
  for (const path of [`/api/projects/${f.projectId}`, `/api/admin/users/${f.userId}`]) {
    const response = await page.request.delete(path);
    if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
  }
});

async function login(page: Page, email = process.env.E2E_EMAIL ?? "admin@example.com") {
  const response = await page.request.post("/api/auth/login", {
    data: { email, password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" },
  });
  expect(response.status()).toBe(200);
}

async function fixture(page: Page, browser: Browser): Promise<Fixture> {
  await login(page);
  const prefix = `R35 visual ${randomUUID().slice(0, 8)}`;
  const token = randomUUID();
  const email = `r35-${token}@example.com`;
  const password = "R35-Visual-2026!";
  const user = await page.request.post("/api/admin/users", {
    data: { name: `R35 sender ${token.slice(0, 6)}`, email, password, role: "member" },
  });
  expect(user.status()).toBe(201);
  const userId = (await user.json() as { id: number }).id;
  const project = await page.request.post("/api/projects", { data: { workspace_id: 1, name: prefix } });
  expect(project.status()).toBe(201);
  const projectId = (await project.json() as { id: number }).id;
  expect((await page.request.post(`/api/projects/${projectId}/members`, {
    data: { user_id: userId, role: "commenter" },
  })).status()).toBe(201);
  const task = await page.request.post("/api/tasks", { data: { project_id: projectId, name: `${prefix} task` } });
  expect(task.status()).toBe(201);
  const taskId = (await task.json() as { id: number }).id;
  const trashTask = await page.request.post("/api/tasks", { data: { project_id: projectId, name: `${prefix} trash` } });
  expect(trashTask.status()).toBe(201);
  const trashTaskId = (await trashTask.json() as { id: number }).id;
  expect((await page.request.delete(`/api/tasks/${trashTaskId}`)).status()).toBe(200);

  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL ?? process.env.BASE,
  });
  expect((await context.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  const comment = await context.request.post("/api/comments", {
    data: { task_id: taskId, body: "R3-5 visual notification" },
  });
  expect(comment.status()).toBe(201);
  const commentId = (await comment.json() as { id: number }).id;
  fixtures.set(page, { prefix, userId, projectId, taskId, trashTaskId, commentId, context });
  return fixtures.get(page)!;
}

const css = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      borderTop: style.borderTopWidth,
      borderTopColor: style.borderTopColor,
      height: element.getBoundingClientRect().height,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      whiteSpace: style.whiteSpace,
      appearance: style.appearance,
      fontFamily: style.fontFamily,
    };
  });

test("C workbench inbox, search, trash and audit share the quiet page and row rhythm", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const f = await fixture(page, browser);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Inbox: the filters are borderless 32px tabs; selection uses the faint
  // accent surface with the accent text, unselected tabs use secondary text.
  await page.goto("/inbox");
  const unreadTab = page.locator('[data-inbox-filter="unread"]');
  await expect(unreadTab).toHaveAttribute("aria-current", "page");
  expect(await css(unreadTab)).toMatchObject({
    background: "rgb(239, 240, 242)",
    color: "rgb(63, 107, 0)",
    borderTop: "0px",
    height: 32,
    fontWeight: "500",
  });
  expect(await css(page.locator('[data-inbox-filter="read"]'))).toMatchObject({
    color: "rgb(58, 64, 73)",
    borderTop: "0px",
    height: 32,
  });
  const entry = page.locator(`[data-inbox-entry="comment-${f.commentId}"]`);
  await expect(entry).toHaveAttribute("data-inbox-unread", "true");
  const readButton = entry.getByRole("button", { name: "既読にする", exact: true });
  await expect(readButton).toBeVisible();
  expect(await css(readButton)).toMatchObject({ height: 28, fontSize: "12px" });
  expect(await css(entry.locator("[data-inbox-meta]"))).toMatchObject({
    fontSize: "12px",
    color: "rgb(92, 100, 112)",
  });
  expect(await css(entry.locator("[data-inbox-entry-icon]"))).toMatchObject({ color: "rgb(92, 100, 112)" });
  expect(await css(page.getByRole("button", { name: "すべて既読にする", exact: true }))).toMatchObject({
    height: 32,
    fontSize: "13px",
  });
  const auto = page.getByRole("checkbox", { name: "自動更新" });
  await expect(auto).toBeChecked();
  await expect(auto).toHaveCSS("accent-color", "rgb(26, 29, 33)");

  // Search: a GET form keeps its names and submitting still works; controls are
  // 32px, the project select has a native chevron and a capped width, and the
  // collapsible groups are quiet surfaces instead of bordered boxes.
  await page.goto("/search");
  const form = page.locator("[data-search-form]");
  await expect(form).toHaveAttribute("method", "GET");
  const keyword = page.locator("[data-search-keyword]");
  expect(await css(keyword)).toMatchObject({ height: 32, fontSize: "13px" });
  const keywordLabel = keyword.locator("xpath=..").locator("span").first();
  expect(await css(keywordLabel)).toMatchObject({ fontSize: "12px", fontWeight: "500", color: "rgb(58, 64, 73)" });
  const projectSelect = form.locator('select[name="project"]');
  expect(await css(projectSelect)).toMatchObject({ height: 32, appearance: "none" });
  const projectBox = (await projectSelect.boundingBox())!;
  expect(projectBox.width).toBeLessThanOrEqual(240.5);
  expect(await css(projectSelect.locator("xpath=..").locator('svg[aria-hidden="true"]'))).toMatchObject({
    color: "rgb(92, 100, 112)",
  });
  const dateDetails = page.locator("details").first();
  expect(await css(dateDetails.locator("summary"))).toMatchObject({ fontSize: "12px", fontWeight: "500", color: "rgb(58, 64, 73)" });
  expect(await css(dateDetails)).toMatchObject({ borderTop: "0px" });
  expect(await css(dateDetails.locator("div").first())).toMatchObject({ background: "rgb(250, 250, 251)" });
  await keyword.fill(f.prefix);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/search" && url.searchParams.get("q") === f.prefix),
    form.getByRole("button", { name: "検索", exact: true }).click(),
  ]);
  const taskSection = page.locator('[data-search-section="tasks"]');
  await expect(taskSection).toBeVisible();
  expect(await css(taskSection.locator("h2"))).toMatchObject({ fontSize: "13px", fontWeight: "600" });
  expect(await css(taskSection.locator("h2 span").first())).toMatchObject({ fontSize: "12px", fontWeight: "400", color: "rgb(92, 100, 112)" });
  const taskRow = taskSection.locator(`[data-search-result-id="${f.taskId}"]`);
  await expect(taskRow).toHaveAttribute("class", /min-h-\[40px\]/);
  expect(await css(taskRow.locator("a").first())).toMatchObject({ fontSize: "13px" });

  // Trash: section headings, row actions and the danger text follow the same
  // rhythm; the purge action is a quiet bordered button with danger text.
  await page.goto("/trash");
  const trashHeading = page.getByRole("heading", { name: /ゴミ箱のタスク/ });
  expect(await css(trashHeading)).toMatchObject({ fontSize: "13px", fontWeight: "600" });
  const trashRow = page.getByText(`${f.prefix} trash`, { exact: true }).locator("..");
  const restore = trashRow.getByRole("button", { name: "復元", exact: true });
  const purge = trashRow.getByRole("button", { name: "完全削除", exact: true });
  expect(await css(restore)).toMatchObject({ height: 28, fontSize: "12px" });
  expect(await css(purge)).toMatchObject({
    height: 28,
    fontSize: "12px",
    color: "rgb(184, 50, 40)",
    borderTopColor: "rgb(228, 230, 234)",
  });

  // Audit: a real table keeps th/scope, the timestamp is one line with the
  // full value in title, and the export actions are quiet 32px links.
  await page.goto("/audit");
  expect(await page.getByRole("table").count()).toBe(1);
  expect(await page.getByRole("columnheader").count()).toBe(4);
  for (const header of await page.getByRole("columnheader").all()) {
    expect(await header.getAttribute("scope")).toBe("col");
  }
  const firstRow = page.locator("[data-audit-row]").first();
  const time = firstRow.locator("time");
  const shown = (await time.textContent())!.trim();
  const full = (await time.getAttribute("title"))!;
  expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(full.startsWith(shown)).toBe(true);
  expect(full.length).toBeGreaterThan(shown.length);
  expect(await css(time)).toMatchObject({ fontSize: "12px", whiteSpace: "nowrap", color: "rgb(92, 100, 112)" });
  expect((await time.boundingBox())!.height).toBeLessThanOrEqual(18);
  expect(await css(firstRow.locator("td").nth(2).locator("span"))).toMatchObject({
    fontSize: "12px",
    background: "rgb(239, 240, 242)",
  });
  expect((await css(firstRow.locator("td").nth(2).locator("span"))).fontFamily.toLowerCase()).toContain("mono");
  for (const format of ["JSON", "CSV"]) {
    const link = page.getByRole("link", { name: format, exact: true });
    expect(await css(link)).toMatchObject({ height: 32, fontSize: "12px" });
    expect(await link.getAttribute("href")).toBe(`/api/admin/audit/export?format=${format.toLowerCase()}`);
  }

  // At 375px the search form becomes one column and the audit table scrolls
  // inside its own container, never widening the page.
  await page.setViewportSize({ width: 375, height: 800 });
  for (const route of ["/inbox", "/search", "/trash", "/audit"]) {
    await page.goto(route);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(overflow.document, route).toBeLessThanOrEqual(overflow.viewport);
  }
  await page.goto("/search");
  const narrowKeyword = await page.locator("[data-search-keyword]").boundingBox();
  expect(narrowKeyword!.width).toBeGreaterThan(200);
  await page.goto("/audit");
  const scroll = page.locator("[data-audit-table-scroll]");
  const scrollMetrics = await scroll.evaluate((element) => ({
    client: element.clientWidth,
    width: element.scrollWidth,
  }));
  expect(scrollMetrics.width).toBeGreaterThan(scrollMetrics.client);

  // Dark keeps the same token pairs: faint selected surface, lime accent text.
  await page.context().addCookies([{ name: "atlas_theme", value: "dark", url: new URL(page.url()).origin }]);
  await page.goto("/inbox");
  expect(await css(page.locator('[data-inbox-filter="unread"]'))).toMatchObject({
    background: "rgb(29, 34, 41)",
    color: "rgb(185, 242, 39)",
    borderTop: "0px",
  });
});
