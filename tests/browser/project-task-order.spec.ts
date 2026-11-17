import { test, expect, type APIResponse, type Page } from "@playwright/test";

type View = "list" | "board";
type ExportTask = { id: number; name: string; section_id: number | null };

async function json<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function project(page: Page) {
  const { id } = await json<{ id: number }>(await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: "Task order " + crypto.randomUUID() },
  }), 201);
  const sections = await json<{ id: number }[]>(await page.request.get("/api/lookup?project_id=" + id), 200);
  return { id, section: sections[0].id };
}

async function task(page: Page, projectId: number, section: number | null, name: string) {
  return (await json<{ id: number }>(await page.request.post("/api/tasks", {
    data: { project_id: projectId, section_id: section, name },
  }), 201)).id;
}

async function exported(page: Page, projectId: number) {
  return (await json<{ tasks: ExportTask[] }>(
    await page.request.get("/api/projects/" + projectId + "/export?format=json"), 200,
  )).tasks;
}

function column(page: Page, view: View, section: number | null) {
  if (view === "board") return page.locator('[data-board-column="' + (section === null ? "s-none" : "s" + section) + '"]');
  return page.locator(section === null ? "[data-list-unsectioned]" : '[data-list-section-block="' + section + '"]');
}

async function verifyOrder(page: Page, view: View, projectId: number, section: number | null, expected: number[]) {
  const attr = view === "list" ? "data-list-row" : "data-board-card";
  const items = column(page, view, section).locator("[" + attr + "]");
  await expect.poll(() => items.evaluateAll((nodes, attr) => nodes.map(n => Number(n.getAttribute(attr))), attr)).toEqual(expected);
  const tasks = await exported(page, projectId);
  expect(tasks.filter(t => t.section_id === section).map(t => t.id)).toEqual(expected);
}

async function drag(page: Page, view: View, moved: number, target: number, side: "before" | "after") {
  const attr = view === "list" ? "data-list-row" : "data-board-card";
  const item = (id: number) => page.locator("[" + attr + '="' + id + '"]');
  const source = item(moved);
  const dest = item(target);
  await source.scrollIntoViewIfNeeded();
  await dest.scrollIntoViewIfNeeded();
  const start = (await source.boundingBox())!;
  const end = (await dest.boundingBox())!;
  // Grab the row handle / card padding so the browser drags the task, not its name link.
  await page.mouse.move(start.x + 5, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 16, start.y + start.height / 2, { steps: 3 });
  const y = end.y + end.height * (side === "before" ? 0.2 : 0.8);
  await page.mouse.move(end.x + 12, y, { steps: 5 });
  await page.mouse.move(end.x + 14, y);
  const [response] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/tasks/" + moved),
    page.mouse.up(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await json(await page.request.post("/api/auth/login", {
    data: { email: "admin@example.com", password: "atlas-dev-2026" },
  }), 200);
});

for (const view of ["list", "board"] as const) {
  test(view + " preserves repeated head, midpoint and cross-section drops through reload and export", async ({ page }) => {
    test.setTimeout(150_000);
    const p = await project(page);
    const other = await json<{ id: number }>(await page.request.post("/api/sections", {
      data: { project_id: p.id, name: "第2セクション" },
    }), 201);
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) ids.push(await task(page, p.id, p.section, "Task " + i));
    const outside = await task(page, p.id, other.id, "Other");
    for (const [id, position] of [[ids[0], -1000], [ids[1], 1062.5]]) {
      await json(await page.request.patch("/api/tasks/" + id, { data: { position } }), 200);
    }
    await page.goto("/projects/" + p.id + "?view=" + view + "&group=section");
    await verifyOrder(page, view, p.id, p.section, ids);
    for (let i = 0; i < 4; i++) {
      const last = ids.pop()!;
      await drag(page, view, last, ids[0], "before");
      ids.unshift(last);
      await verifyOrder(page, view, p.id, p.section, ids);
    }
    // Re-use one gap until double precision runs out, forcing rank normalization.
    const anchor = ids[2];
    for (let i = 0; i < 56; i++) {
      const at = ids.indexOf(anchor);
      const moved = at === ids.length - 1 ? ids.shift()! : ids.pop()!;
      await drag(page, view, moved, anchor, "before");
      ids.splice(ids.indexOf(anchor), 0, moved);
      await verifyOrder(page, view, p.id, p.section, ids);
    }
    const cross = ids.shift()!;
    await drag(page, view, cross, outside, "after");
    await verifyOrder(page, view, p.id, other.id, [outside, cross]);
    await page.reload();
    await verifyOrder(page, view, p.id, p.section, ids);
    await verifyOrder(page, view, p.id, other.id, [outside, cross]);
    const otherView = view === "board" ? "list" : "board";
    await page.goto("/projects/" + p.id + "?view=" + otherView + "&group=section");
    await verifyOrder(page, otherView, p.id, p.section, ids);
    await verifyOrder(page, otherView, p.id, other.id, [outside, cross]);
  });
}

test("equal ranks and shared placements preserve each project's order", async ({ page, playwright }) => {
  const p = await project(page);
  const home = await project(page);
  const left = await task(page, p.id, p.section, "Left");
  const right = await task(page, p.id, p.section, "Right");
  const shared = await task(page, home.id, home.section, "Shared");
  await task(page, home.id, home.section, "Home only");
  const loose = await task(page, p.id, null, "Unsectioned");
  for (const id of [left, right]) {
    await json(await page.request.patch("/api/tasks/" + id, { data: { position: 1062.5 } }), 200);
    await json(await page.request.post("/api/memberships", {
      data: { task_id: id, project_id: home.id, section_id: home.section },
    }), 201);
  }
  await json(await page.request.post("/api/memberships", {
    data: { task_id: shared, project_id: p.id, section_id: p.section },
  }), 201);
  const untouched = await exported(page, home.id);
  await page.goto("/projects/" + p.id + "?view=list&group=section");
  await verifyOrder(page, "list", p.id, p.section, [shared, left, right]);
  await drag(page, "list", shared, right, "before");
  await verifyOrder(page, "list", p.id, p.section, [left, shared, right]);
  expect(await exported(page, home.id)).toEqual(untouched);

  await page.goto("/projects/" + p.id + "?view=board&group=section");
  await verifyOrder(page, "board", p.id, p.section, [left, shared, right]);
  await drag(page, "board", shared, loose, "before");
  await verifyOrder(page, "board", p.id, null, [shared, loose]);
  await page.reload();
  await verifyOrder(page, "board", p.id, null, [shared, loose]);
  expect(await exported(page, home.id)).toEqual(untouched);

  const local = await exported(page, p.id);
  const options = await json<{id: number}[]>(await page.request.get("/api/reference-options?project_ids=" + p.id), 200);
  expect(options.map(t => t.id)).toEqual(local.map(t => t.id));
  const foreignAnchor = untouched.find(t => t.name === "Home only")!.id;
  const invalid = await page.request.patch("/api/tasks/" + shared, {
    data: { placement: { project_id: p.id, anchor_id: foreignAnchor, side: "before" }, section_id: p.section },
  });
  expect(invalid.status()).toBe(409);
  expect(await exported(page, p.id)).toEqual(local);
  expect(await exported(page, home.id)).toEqual(untouched);

  await json(await page.request.post("/api/projects/" + p.id + "/members", {
    data: { user_id: 2, role: "editor" },
  }), 201);
  const editor = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await json(await editor.post("/api/auth/login", {
      data: { email: "tanaka@example.com", password: "atlas-dev-2026" },
    }), 200);
    const patch = (projectId: number, anchorId: number) => editor.patch("/api/tasks/" + shared, {
      data: { placement: { project_id: projectId, anchor_id: anchorId, side: "after" } },
    });
    expect((await patch(home.id, foreignAnchor)).status()).toBe(403);
    await json(await patch(p.id, loose), 200);
    expect((await exported(page, p.id)).filter(t => t.section_id === null).map(t => t.id)).toEqual([loose, shared]);
    expect(await exported(page, home.id)).toEqual(untouched);
  } finally {
    await editor.dispose();
  }
});

test("same-gap requests serialize and stale task versions cannot move a row", async ({ page }) => {
  const p = await project(page);
  const ids: number[] = [];
  for (const name of ["anchor", "one", "two", "tail"]) ids.push(await task(page, p.id, p.section, name));
  const placement = { project_id: p.id, anchor_id: ids[0], side: "before" };
  const responses = await Promise.all(ids.slice(1, 3).map(id =>
    page.request.patch("/api/tasks/" + id, { data: { placement } })));
  for (const response of responses) expect(response.status(), await response.text()).toBe(200);
  const order = (await exported(page, p.id)).map(t => t.id);
  expect(order.slice(0, 2).sort((a, b) => a - b)).toEqual(ids.slice(1, 3));
  expect(order.slice(2)).toEqual([ids[0], ids[3]]);
  const stale = await page.request.patch("/api/tasks/" + ids[3], {
    data: { placement, expected_updated_at: "2000-01-01T00:00:00Z" },
  });
  expect(stale.status()).toBe(409);
  expect((await exported(page, p.id)).map(t => t.id)).toEqual(order);
  await page.goto("/projects/" + p.id + "?view=list&group=section");
  await verifyOrder(page, "list", p.id, p.section, order);
});
