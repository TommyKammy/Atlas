import { test, expect, type Page } from "@playwright/test";
import type { ProjectKnowledge } from "../../lib/data";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const projects = new WeakMap<Page, number[]>();
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" }); await page.goto("about:blank");
  for (const id of projects.get(page) ?? []) await page.request.delete(`/api/projects/${id}`);
});
async function fixture(page: Page, count = 4) {
  const response = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `ノート順序 ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const { id } = await response.json(); projects.set(page, [...projects.get(page) ?? [], id]);
  const notes: ProjectKnowledge[] = [];
  for (let i = 0; i < count; i++) {
    const result = await page.request.post("/api/knowledge", { data: { project_id: id, title: `ノート ${i + 1}`, body: `## 本文 ${i + 1}\n\n原文を保持  ` } });
    expect(result.status()).toBe(201); notes.push(await result.json());
  }
  await page.goto(`/projects/${id}?view=knowledge&note=${notes[0].id}`);
  await expect(page.locator("[data-knowledge-note]").first()).toBeVisible();
  // Hydration is complete once the note name can respond to keyboard focus.
  await page.locator("[data-note-reorder]").first().focus();
  return { id, notes, ids: notes.map(note => note.id) };
}
async function order(page: Page) {
  return page.locator("[data-knowledge-note]").evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("data-knowledge-note"))));
}
async function read(page: Page, id: number): Promise<ProjectKnowledge> { return (await page.request.get(`/api/knowledge/${id}`)).json(); }
async function drag(page: Page, from: number, to: number, placement: "before" | "after") {
  await page.locator(`[data-note-reorder="${from}"]`).scrollIntoViewIfNeeded();
  const a = (await page.locator(`[data-note-reorder="${from}"] [data-reorder-label]`).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.locator(`[data-note-row="${to}"]`).scrollIntoViewIfNeeded();
  const b = (await page.locator(`[data-note-row="${to}"]`).boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + (placement === "before" ? 8 : b.height - 8), { steps: 8 });
  await expect(page.locator(`[data-note-row="${to}"] [data-note-drop]`)).toHaveAttribute("data-note-drop", placement);
  await page.mouse.up();
  await expect(page.locator("[data-note-order-status]")).toHaveText("並び順を保存しました");
}

test("selecting, editing and reloading never reorder notes; newly created notes append", async ({ page }) => {
  const f = await fixture(page);
  for (const note of [...f.notes].reverse()) {
    await page.locator(`[data-knowledge-note="${note.id}"]`).click();
    await expect(page.locator(`[data-knowledge-note="${note.id}"]`)).toHaveAttribute("aria-current", "page");
    expect(await order(page)).toEqual(f.ids);
  }
  await page.locator(`[data-knowledge-note="${f.ids[2]}"]`).click();
  await page.locator("[data-knowledge-edit]").click();
  await page.getByRole("textbox", { name: "ノートのタイトル", exact: true }).fill("改訂したタイトル");
  await expect(page.locator("[data-knowledge-save-status]")).toHaveText("すべての変更を保存しました");
  expect(await order(page)).toEqual(f.ids);
  await page.reload(); expect(await order(page)).toEqual(f.ids);
  const added = await (await page.request.post("/api/knowledge", { data: { project_id: f.id, title: "追加ノート", body: "末尾" } })).json();
  await page.reload(); expect(await order(page)).toEqual([...f.ids, added.id]);
});

test("note names support ordinary clicks, small pointer movement and keyboard activation without reordering", async ({ page }) => {
  const f = await fixture(page);
  await expect(page.locator("[data-note-handle]")).toHaveCount(0);
  let writes = 0;
  page.on("request", request => { if (request.url().endsWith("/api/knowledge/reorder")) writes++; });
  const name = page.locator(`[data-knowledge-note="${f.ids[2]}"] [data-reorder-label]`);
  const bounds = (await name.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + 33, bounds.y + bounds.height / 2); await page.mouse.up();
  await expect(page.locator(`[data-knowledge-note="${f.ids[2]}"]`)).toHaveAttribute("aria-current", "page");
  await page.locator(`[data-knowledge-note="${f.ids[1]}"]`).press("Enter");
  await expect(page.locator(`[data-knowledge-note="${f.ids[1]}"]`)).toHaveAttribute("aria-current", "page");
  expect(await order(page)).toEqual(f.ids); expect(writes).toBe(0);
});

test("dragging in both directions persists order without selecting or changing content/history", async ({ page }) => {
  const f = await fixture(page);
  await drag(page, f.ids[3], f.ids[0], "before");
  expect(await order(page)).toEqual([f.ids[3], ...f.ids.slice(0, 3)]);
  await expect(page.locator(`[data-knowledge-note="${f.ids[0]}"]`)).toHaveAttribute("aria-current", "page");
  await drag(page, f.ids[0], f.ids[2], "after");
  const expected = [f.ids[3], f.ids[1], f.ids[2], f.ids[0]];
  expect(await order(page)).toEqual(expected);
  await page.reload(); expect(await order(page)).toEqual(expected);
  for (const original of f.notes) {
    const after = await read(page, original.id);
    expect(after).toEqual({ ...original, position: after.position });
    expect(await (await page.request.get(`/api/knowledge/${original.id}?history=1`)).json()).toEqual([]);
  }
});

test("keyboard reorder preserves a mounted editor and its autosave", async ({ page }) => {
  const f = await fixture(page);
  await page.locator("[data-knowledge-edit]").click();
  const title = page.getByRole("textbox", { name: "ノートのタイトル", exact: true });
  await title.fill("編集中のノート");
  const handle = page.locator(`[data-note-reorder="${f.ids[2]}"]`);
  await handle.press("Alt+ArrowUp");
  await expect(page.locator("[data-note-order-status]")).toHaveText("並び順を保存しました");
  expect(await order(page)).toEqual([f.ids[0], f.ids[2], f.ids[1], f.ids[3]]);
  await expect(title).toHaveValue("編集中のノート");
  await expect(page.locator("[data-knowledge-save-status]")).toHaveText("すべての変更を保存しました");
  expect((await read(page, f.ids[0])).title).toBe("編集中のノート");
  await expect(handle).toBeFocused();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => order(page)).toEqual(f.ids);
  await expect(page.locator("[data-note-order-status]")).toHaveText("並び順を保存しました");
});

test("failed reorder rolls back only positions and allows retry", async ({ page }) => {
  const f = await fixture(page);
  await page.locator("[data-knowledge-edit]").click();
  const title = page.getByRole("textbox", { name: "ノートのタイトル", exact: true });
  await title.fill("保存中も維持するタイトル");
  await page.route("**/api/knowledge/reorder", async route => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "並び順を保存できませんでした" }) });
  });
  await page.locator(`[data-note-reorder="${f.ids[2]}"]`).press("Alt+ArrowUp");
  await expect(page.locator("[data-knowledge]").getByRole("alert")).toHaveText("並び順を保存できませんでした");
  expect(await order(page)).toEqual(f.ids);
  await expect(page.locator("[data-knowledge-save-status]")).toHaveText("すべての変更を保存しました");
  await expect(title).toHaveValue("保存中も維持するタイトル");
  expect((await read(page, f.ids[0])).title).toBe("保存中も維持するタイトル");
  await page.getByRole("button", { name: "編集を終了", exact: true }).click();
  await expect(page.locator("[data-knowledge] h1")).toHaveText("保存中も維持するタイトル");
  await page.unroute("**/api/knowledge/reorder");
  await drag(page, f.ids[2], f.ids[0], "before");
  await page.reload(); expect(await order(page)).toEqual([f.ids[2], f.ids[0], f.ids[1], f.ids[3]]);
});

test("Escape and dropping outside cancel; filtering disables reordering", async ({ page }) => {
  const f = await fixture(page);
  let writes = 0; page.on("request", req => { if (req.url().endsWith("/api/knowledge/reorder")) writes++; });
  for (const escape of [true, false]) {
    const a = (await page.locator(`[data-note-reorder="${f.ids[0]}"] [data-reorder-label]`).boundingBox())!;
    const b = (await page.locator(`[data-note-row="${f.ids[2]}"]`).boundingBox())!;
    await page.mouse.move(a.x + 10, a.y + 10); await page.mouse.down();
    await page.mouse.move(b.x + 30, b.y + b.height - 8, { steps: 5 });
    await expect(page.locator("[data-note-drop]")).toHaveCount(1);
    if (escape) await page.keyboard.press("Escape"); else await page.mouse.move(1200, 50);
    await page.mouse.up();
    expect(await order(page)).toEqual(f.ids);
    await expect(page.locator(`[data-knowledge-note="${f.ids[0]}"]`)).toHaveAttribute("aria-current", "page");
  }
  expect(writes).toBe(0);
  await page.locator(`[data-knowledge-note="${f.ids[2]}"] [data-reorder-label]`).click();
  await expect(page.locator(`[data-knowledge-note="${f.ids[2]}"]`)).toHaveAttribute("aria-current", "page");
  await page.getByRole("searchbox", { name: "ノートを検索" }).fill("ノート 2");
  await expect(page.locator("[data-knowledge-note]")).toHaveCount(1);
  await expect(page.locator("[data-note-reorder]")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "ノートを検索" }).fill("");
  expect(await order(page)).toEqual(f.ids);
});

test("long lists scroll while dragging at the edge", async ({ page }) => {
  const f = await fixture(page, 24);
  const list = page.getByRole("navigation", { name: "ノートを選択" });
  const bounds = (await list.boundingBox())!;
  const handle = (await page.locator(`[data-note-reorder="${f.ids[0]}"] [data-reorder-label]`).boundingBox())!;
  await page.mouse.move(handle.x + 10, handle.y + 10); await page.mouse.down();
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height - 3, { steps: 10 });
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(250);
  await expect.poll(() => list.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), { timeout: 10000 }).toBe(true);
  await page.mouse.up();
  await expect(page.locator("[data-note-order-status]")).toHaveText("並び順を保存しました");
  expect(await order(page)).toEqual([...f.ids.slice(1), f.ids[0]]);
});

test("touch name drag works on a narrow screen without horizontal overflow", async ({ page, browser }) => {
  const f = await fixture(page, 8);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await context.request.post("/api/auth/login", { data: credentials });
    const mobile = await context.newPage(); await mobile.goto(`/projects/${f.id}?view=knowledge`);
    const handle = mobile.locator(`[data-note-reorder="${f.ids[0]}"]`);
    await expect(handle).toBeVisible();
    const a = (await handle.locator("[data-reorder-label]").boundingBox())!;
    const b = (await mobile.locator(`[data-note-row="${f.ids[2]}"]`).boundingBox())!;
    const session = await context.newCDPSession(mobile);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x + 10, y: a.y + 10 }] });
    // Send a paced drag, not an instantaneous full-row jump. Linux Chromium
    // otherwise consumes the following tap instead of generating its click.
    const start = { x: a.x + 10, y: a.y + 10 };
    const end = { x: b.x + 30, y: b.y + b.height - 8 };
    for (let step = 1; step <= 10; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
        x: start.x + (end.x - start.x) * step / 10,
        y: start.y + (end.y - start.y) * step / 10,
      }] });
      await mobile.waitForTimeout(40);
    }
    await expect(mobile.locator("[data-note-drop]")).toHaveCount(1);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(mobile.locator("[data-note-order-status]")).toHaveText("並び順を保存しました");
    expect(await order(mobile)).toEqual([f.ids[1], f.ids[2], f.ids[0], ...f.ids.slice(3)]);
    await expect(mobile.locator(`[data-knowledge-note="${f.ids[0]}"]`)).toHaveAttribute("aria-current", "page");
    await mobile.locator(`[data-knowledge-note="${f.ids[2]}"] [data-reorder-label]`).tap();
    await expect(mobile.locator(`[data-knowledge-note="${f.ids[2]}"]`)).toHaveAttribute("aria-current", "page");
    // The date below the name remains a native touch-scrolling surface.
    const date = (await mobile.locator(`[data-knowledge-note="${f.ids[0]}"] > span`).last().boundingBox())!;
    const beforeScroll = await order(mobile);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: date.x + 40, y: date.y + 5 }] });
    for (const delta of [25, 60, 100]) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: date.x + 40, y: date.y + 5 - delta }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => mobile.getByRole("navigation", { name: "ノートを選択" }).evaluate(el => el.scrollTop)).toBeGreaterThan(20);
    expect(await order(mobile)).toEqual(beforeScroll);
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});

test("relative moves preserve unloaded notes and pagination after a deep-linked move", async ({ page }) => {
  test.setTimeout(60000);
  const f = await fixture(page, 105);
  await page.goto(`/projects/${f.id}?view=knowledge&note=${f.ids[104]}`);
  await expect(page.locator("[data-knowledge-note]")).toHaveCount(101);
  // These rows look adjacent locally, but four unloaded notes separate them.
  await drag(page, f.ids[99], f.ids[104], "before");
  const moved = await (await page.request.get(`/api/knowledge?project_id=${f.id}&offset=99`)).json();
  expect(moved.map((note: ProjectKnowledge) => note.id)).toEqual([...f.ids.slice(100, 104), f.ids[99], f.ids[104]]);
  // Crossing the pagination boundary must not skip the former row 101.
  await drag(page, f.ids[0], f.ids[104], "after");
  await page.getByRole("button", { name: "さらに読み込む" }).click();
  await expect(page.locator("[data-knowledge-note]")).toHaveCount(105);
  const first = await (await page.request.get(`/api/knowledge?project_id=${f.id}`)).json();
  const rest = await (await page.request.get(`/api/knowledge?project_id=${f.id}&offset=100`)).json();
  expect(await order(page)).toEqual([...first, ...rest].map(note => note.id));
  expect(new Set(await order(page))).toEqual(new Set(f.ids));
});

test("reorder enforces edit permissions, project boundaries and input validation", async ({ page, browser }) => {
  const f = await fixture(page), otherProject = await fixture(page, 1);
  const data = { project_id: f.id, note_id: f.ids[0], target_id: f.ids[1], placement: "after" };
  for (const change of [{ note_id: 1.5 }, { target_id: -1 }, { placement: "middle" }, { note_id: "1" }]) {
    expect((await page.request.post("/api/knowledge/reorder", { data: { ...data, ...change } })).status()).toBe(400);
  }
  expect((await page.request.post("/api/knowledge/reorder", { data: { ...data, target_id: otherProject.ids[0] } })).status()).toBe(404);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await other.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } });
    expect((await other.request.post("/api/knowledge/reorder", { data })).status()).toBe(403);
    await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } });
    expect((await other.request.post("/api/knowledge/reorder", { data })).status()).toBe(403);
    const viewer = await other.newPage(); await viewer.goto(`/projects/${f.id}?view=knowledge`);
    await expect(viewer.locator("[data-knowledge-note]")).toHaveCount(4);
    await expect(viewer.locator("[data-note-reorder]")).toHaveCount(0);
  } finally { await other.close(); }
  expect((await page.request.get(`/api/knowledge?project_id=${f.id}`)).status()).toBe(200);
  expect((await (await page.request.get(`/api/knowledge?project_id=${f.id}`)).json()).map((note: ProjectKnowledge) => note.id)).toEqual(f.ids);
});

test("concurrent relative moves and creation retain every note and both independent moves", async ({ page }) => {
  const f = await fixture(page);
  const results = await Promise.all([
    page.request.post("/api/knowledge/reorder", { data: { project_id: f.id, note_id: f.ids[3], target_id: f.ids[0], placement: "before" } }),
    page.request.post("/api/knowledge/reorder", { data: { project_id: f.id, note_id: f.ids[1], target_id: f.ids[2], placement: "after" } }),
    page.request.post("/api/knowledge", { data: { project_id: f.id, title: "同時に作成", body: "末尾に追加" } }),
  ]);
  expect(results.map(result => result.status())).toEqual([200, 200, 201]);
  const created = await results[2].json();
  const canonical = await (await page.request.get(`/api/knowledge?project_id=${f.id}`)).json();
  expect(canonical.map((note: ProjectKnowledge) => note.id)).toEqual([f.ids[3], f.ids[0], f.ids[2], f.ids[1], created.id]);
  for (const note of f.notes) expect(await read(page, note.id)).toMatchObject({ revision: note.revision, body: note.body, updated_at: note.updated_at });
});
