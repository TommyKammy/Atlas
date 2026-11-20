import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const endpoint = "/api/sidebar/projects/order";
const fixtures = new WeakMap<Page, { ids: number[]; original: number[] }>();
const row = (page: Page, id: number) => page.locator(`[data-sidebar-project="${id}"]`);
const item = (page: Page, id: number) => page.locator(`[data-project-reorder="${id}"]`);
const status = (page: Page) => page.locator("[data-project-order-status]");
const visibleOrder = (page: Page) => page.locator("[data-sidebar-project]").evaluateAll(rows => rows.map(row => Number(row.getAttribute("data-sidebar-project"))));
async function serverOrder(request: APIRequestContext) {
  const result = await request.get(`${endpoint}?workspace_id=1`); expect(result.status()).toBe(200);
  return (await result.json()).order as number[];
}
const move = (request: APIRequestContext, projectId: number, targetId: number, placement = "before") =>
  request.post(endpoint, { data: { workspace_id: 1, project_id: projectId, target_id: targetId, placement } });

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  fixtures.set(page, { ids: [], original: await serverOrder(page.request) });
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" }); await page.goto("about:blank");
  const fixture = fixtures.get(page)!;
  for (const id of fixture.ids) await page.request.delete(`/api/projects/${id}`);
  for (let i = fixture.original.length - 2; i >= 0; i--) await move(page.request, fixture.original[i], fixture.original[i + 1]);
});
async function create(page: Page, title: string) {
  const result = await page.request.post("/api/projects", { data: { workspace_id: 1, name: title } });
  expect(result.status()).toBe(201); const { id } = await result.json();
  fixtures.get(page)!.ids.push(id); return id as number;
}
async function fixture(page: Page, count = 4) {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(await create(page, `並び替え検証 ${i + 1}`));
  await page.goto("/");
  await expect(row(page, ids[0])).toBeVisible();
  return { ids, all: await serverOrder(page.request) };
}
async function startDrag(page: Page, id: number) {
  await item(page, id).scrollIntoViewIfNeeded();
  const bounds = (await item(page, id).locator("[data-reorder-label]").boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
}
async function drag(page: Page, id: number, target: number, placement: "before" | "after") {
  await startDrag(page, id);
  await row(page, target).scrollIntoViewIfNeeded();
  const bounds = (await row(page, target).boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + (placement === "before" ? 5 : bounds.height - 5), { steps: 8 });
  await expect(row(page, target).locator("[data-project-drop]")).toHaveAttribute("data-project-drop", placement);
  await page.mouse.up();
  await expect(status(page)).toHaveText("並び順を保存しました");
  await expect(item(page, id)).toHaveAttribute("data-reorderable", "true");
}

test("dragging both ways persists personal order without navigation or changing recents", async ({ page, browser }) => {
  const f = await fixture(page);
  await page.goto(`/projects/${f.ids[1]}`); await page.goto(`/projects/${f.ids[2]}`); await page.goto("/");
  const recentLinks = page.locator("[data-sidebar-recents] a");
  const recentHrefs = () => recentLinks.evaluateAll(links => links.map(link => link.getAttribute("href")));
  // Visits are recorded in the background, so the first home render can still
  // show the order from before the last visit. Wait until both visits are in
  // place before taking the snapshot the drag must not change.
  await expect.poll(async () => {
    const hrefs = await recentHrefs();
    if (hrefs[0] !== `/projects/${f.ids[2]}`) await page.reload();
    return hrefs.slice(0, 2);
  }).toEqual([`/projects/${f.ids[2]}`, `/projects/${f.ids[1]}`]);
  const recents = await recentHrefs();
  await expect(page.locator("[data-sidebar-recents] [data-project-reorder]")).toHaveCount(0);
  const url = page.url();
  await expect(page.locator("[data-project-handle]")).toHaveCount(0);
  await drag(page, f.ids[3], f.ids[0], "before");
  expect(page.url()).toBe(url);
  await drag(page, f.ids[0], f.ids[2], "after");
  expect(page.url()).toBe(url);
  const expected = [...f.all.filter(id => !f.ids.includes(id)), f.ids[3], f.ids[1], f.ids[2], f.ids[0]];
  expect(await visibleOrder(page)).toEqual(expected);
  expect(await recentHrefs()).toEqual(recents);
  await page.reload(); expect(await visibleOrder(page)).toEqual(expected);
  const ssr = await browser.newContext({ baseURL: test.info().project.use.baseURL, javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const serverPage = await ssr.newPage(); await serverPage.goto("/");
    expect(await visibleOrder(serverPage)).toEqual(expected);
  } finally { await ssr.close(); }
});

test("project names retain clicks with small movement, modifier clicks and keyboard navigation", async ({ page }) => {
  const f = await fixture(page);
  let writes = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith(endpoint)) writes++; });
  await item(page, f.ids[1]).scrollIntoViewIfNeeded();
  const bounds = (await item(page, f.ids[1]).locator("[data-reorder-label]").boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + 33, bounds.y + bounds.height / 2); await page.mouse.up();
  await expect(page).toHaveURL(new RegExp(`/projects/${f.ids[1]}(?:\\?|$)`));
  expect(await visibleOrder(page)).toEqual(f.all);
  await item(page, f.ids[2]).press("Enter");
  await expect(page).toHaveURL(new RegExp(`/projects/${f.ids[2]}(?:\\?|$)`));
  const url = page.url();
  const popupPromise = page.context().waitForEvent("page");
  await item(page, f.ids[3]).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  const popup = await popupPromise;
  try { await expect(popup).toHaveURL(new RegExp(`/projects/${f.ids[3]}(?:\\?|$)`)); } finally { await popup.close(); }
  expect(new URL(page.url()).pathname).toBe(new URL(url).pathname); expect(writes).toBe(0);
});

test("keyboard order keeps focus; project links and context menu keep working after refresh", async ({ page }) => {
  const f = await fixture(page);
  await item(page, f.ids[2]).press("Alt+ArrowUp");
  await expect(status(page)).toHaveText("並び順を保存しました");
  await expect(item(page, f.ids[2])).toBeFocused();
  const expected = [...f.all.filter(id => !f.ids.includes(id)), f.ids[0], f.ids[2], f.ids[1], f.ids[3]];
  expect(await visibleOrder(page)).toEqual(expected);
  await row(page, f.ids[2]).getByRole("link").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await row(page, f.ids[1]).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${f.ids[1]}(?:\\?|$)`));
  expect(await visibleOrder(page)).toEqual(expected);
  await page.locator("#atlas-sidebar-content").getByRole("link", { name: "マイタスク", exact: true }).click();
  await expect(page).toHaveURL(/\/my-tasks/);
  expect(await visibleOrder(page)).toEqual(expected);
});

test("failed save rolls back and a later drag can retry", async ({ page }) => {
  const f = await fixture(page);
  await page.route(`**${endpoint}`, async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
  });
  await item(page, f.ids[2]).press("Alt+ArrowUp");
  await expect(page.locator("#atlas-sidebar-content").getByRole("alert")).toContainText("並び順を保存できませんでした");
  expect(await visibleOrder(page)).toEqual(f.all); expect(await serverOrder(page.request)).toEqual(f.all);
  await page.unroute(`**${endpoint}`);
  await drag(page, f.ids[2], f.ids[0], "before");
  expect(await serverOrder(page.request)).toEqual([...f.all.filter(id => !f.ids.includes(id)), f.ids[2], f.ids[0], f.ids[1], f.ids[3]]);
});

test("Escape, pointer cancellation, blur and dropping into recents never persist a move", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/projects/${f.ids[0]}`); await page.goto("/");
  const url = page.url();
  let writes = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith(endpoint)) writes++; });
  for (const cancel of ["Escape", "pointercancel", "lostpointercapture", "blur", "recents", "outside"] as const) {
    await startDrag(page, f.ids[0]);
    const target = (await row(page, f.ids[2]).boundingBox())!;
    await page.mouse.move(target.x + 30, target.y + target.height - 5, { steps: 4 });
    await expect(page.locator("[data-project-drop]")).toHaveCount(1);
    if (cancel === "Escape") await page.keyboard.press("Escape");
    else if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else if (cancel === "pointercancel" || cancel === "lostpointercapture") await item(page, f.ids[0]).dispatchEvent(cancel, { pointerId: 1 });
    else if (cancel === "recents") {
      const recent = (await page.locator("[data-sidebar-recents] a").first().boundingBox())!;
      await page.mouse.move(recent.x + 30, recent.y + 10);
    } else await page.mouse.move(900, 80);
    await page.mouse.up();
    await expect(page.locator("[data-project-drop]")).toHaveCount(0);
    expect(await visibleOrder(page)).toEqual(f.all);
    expect(page.url()).toBe(url);
  }
  expect(writes).toBe(0);
  await item(page, f.ids[2]).locator("[data-reorder-label]").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${f.ids[2]}(?:\\?|$)`));
});

test("long lists auto-scroll in the sidebar and can drop at the bottom", async ({ page }) => {
  const f = await fixture(page, 30);
  const nav = page.locator("[data-sidebar-navigation]");
  await startDrag(page, f.ids[0]);
  const bounds = (await nav.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height - 5, { steps: 8 });
  await expect.poll(() => nav.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), { timeout: 10000 }).toBe(true);
  await page.mouse.up();
  await expect(status(page)).toHaveText("並び順を保存しました");
  expect(await visibleOrder(page)).toEqual([...f.all.filter(id => id !== f.ids[0]), f.ids[0]]);
});

test("touch drag works at tablet width and does not resize the sidebar", async ({ page, browser }) => {
  const f = await fixture(page);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 768, height: 1000 }, hasTouch: true });
  try {
    await context.request.post("/api/auth/login", { data: credentials });
    const tablet = await context.newPage(); await tablet.goto("/");
    await item(tablet, f.ids[0]).scrollIntoViewIfNeeded();
    const sidebarWidth = (await tablet.locator("[data-sidebar]").boundingBox())!.width;
    const a = (await item(tablet, f.ids[0]).locator("[data-reorder-label]").boundingBox())!, b = (await row(tablet, f.ids[2]).boundingBox())!;
    const cdp = await context.newCDPSession(tablet);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x + 10, y: a.y + 10 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: b.x + 30, y: b.y + b.height - 5 }] });
    await expect(tablet.locator("[data-project-drop]")).toHaveCount(1);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(status(tablet)).toHaveText("並び順を保存しました");
    expect(await visibleOrder(tablet)).toEqual([...f.all.filter(id => !f.ids.includes(id)), f.ids[1], f.ids[2], f.ids[0], f.ids[3]]);
    expect((await tablet.locator("[data-sidebar]").boundingBox())!.width).toBe(sidebarWidth);
    expect(await tablet.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});

test("renaming, creation, archive and deletion reconcile with the manual order", async ({ page }) => {
  const f = await fixture(page);
  await drag(page, f.ids[3], f.ids[0], "before");
  await row(page, f.ids[1]).getByRole("link").click({ button: "right" });
  await page.getByRole("menu").getByRole("button", { name: "名前を変更", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("名前を変更したプロジェクト");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(row(page, f.ids[1]).getByRole("link")).toContainText("名前を変更したプロジェクト");
  const added = await create(page, "新規プロジェクトは末尾");
  await page.reload();
  expect((await visibleOrder(page)).at(-1)).toBe(added);
  expect((await visibleOrder(page)).filter(id => f.ids.includes(id))).toEqual([f.ids[3], f.ids[0], f.ids[1], f.ids[2]]);
  expect((await page.request.patch(`/api/projects/${f.ids[0]}`, { data: { archived: true } })).status()).toBe(200);
  expect((await page.request.delete(`/api/projects/${f.ids[2]}`)).status()).toBe(200);
  await page.reload();
  expect((await visibleOrder(page)).filter(id => f.ids.includes(id))).toEqual([f.ids[3], f.ids[1]]);
  expect((await move(page.request, f.ids[0], f.ids[1])).status()).toBe(404);
  expect((await move(page.request, f.ids[2], f.ids[1])).status()).toBe(404);
});

test("viewers can arrange their own visible projects; outsiders and other workspaces are rejected", async ({ page, browser }) => {
  const f = await fixture(page);
  for (const id of f.ids.slice(0, 2)) {
    expect((await page.request.post(`/api/projects/${id}/members`, { data: { user_id: 2, role: "viewer" } })).status()).toBe(201);
  }
  const viewer = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await viewer.request.post(endpoint, { data: { workspace_id: 1, project_id: f.ids[0], target_id: f.ids[1], placement: "after" } })).status()).toBe(401);
    await viewer.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } });
    const before = await serverOrder(viewer.request);
    expect(before).not.toContain(f.ids[2]);
    expect((await viewer.request.post(endpoint, { data: { workspace_id: 1, project_id: f.ids[1], target_id: f.ids[0], placement: "before", user_id: 1 } })).status()).toBe(200);
    expect((await serverOrder(viewer.request)).filter(id => f.ids.includes(id))).toEqual([f.ids[1], f.ids[0]]);
    expect(await serverOrder(page.request)).toEqual(f.all);
    expect((await move(viewer.request, f.ids[2], f.ids[0])).status()).toBe(404);
    expect((await move(viewer.request, f.ids[0], f.ids[2])).status()).toBe(404);
    expect((await viewer.request.post(endpoint, { data: { workspace_id: 999999, project_id: f.ids[0], target_id: f.ids[1], placement: "before" } })).status()).toBe(404);
    const viewerPage = await viewer.newPage(); await viewerPage.goto("/");
    await expect(item(viewerPage, f.ids[0])).toBeVisible();
    expect((await visibleOrder(viewerPage)).filter(id => f.ids.includes(id))).toEqual([f.ids[1], f.ids[0]]);
  } finally { await viewer.close(); }
});

test("malformed requests fail without changing order; relative concurrent moves both survive", async ({ page }) => {
  const f = await fixture(page);
  const data = { workspace_id: 1, project_id: f.ids[0], target_id: f.ids[1], placement: "after" };
  for (const change of [{ project_id: "1" }, { target_id: -2 }, { target_id: 0.5 }, { workspace_id: 0 }, { placement: "middle" }]) {
    expect((await page.request.post(endpoint, { data: { ...data, ...change } })).status()).toBe(400);
  }
  expect((await page.request.post(endpoint, { data: null })).status()).toBe(400);
  expect((await page.request.get(`${endpoint}?workspace_id=Infinity`)).status()).toBe(400);
  expect(await serverOrder(page.request)).toEqual(f.all);
  const results = await Promise.all([move(page.request, f.ids[3], f.ids[0]), move(page.request, f.ids[1], f.ids[2], "after")]);
  expect(results.map(result => result.status())).toEqual([200, 200]);
  expect(await serverOrder(page.request)).toEqual([...f.all.filter(id => !f.ids.includes(id)), f.ids[3], f.ids[0], f.ids[2], f.ids[1]]);
});
