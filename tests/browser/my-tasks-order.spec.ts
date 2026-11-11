import { expect, test, type Page, type Route } from "@playwright/test";
import { todayISO } from "../../lib/dates";
import { shiftDay } from "../../lib/calendar";
import type { MyTaskSnapshot } from "../../lib/my-task-order";

const projects = new WeakMap<Page, number[]>();

test.afterEach(async ({ page }, info) => {
  info.setTimeout(15_000);
  for (const id of projects.get(page) ?? []) {
    try {
      const response = await page.request.delete(`/api/projects/${id}`, { timeout: 10_000 });
      expect(response.status()).toBe(200);
    } catch (error) {
      if (info.status === info.expectedStatus) throw error;
      info.annotations.push({ type: "cleanup", description: String(error) });
    }
  }
});

async function fixture(page: Page) {
  const login = await page.request.post("/api/auth/login", { data: {
    email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
  } });
  expect(login.ok()).toBeTruthy();
  const meResponse = await page.request.get("/api/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json() as { id: number; name: string };
  const prefix = `EV03 ${test.info().testId.slice(0, 40)} ${Date.now()}`;
  const created = await page.request.post("/api/projects", { data: { workspace_id: 1, name: prefix } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: number };
  projects.set(page, [...projects.get(page) ?? [], id]);
  return { id, me, prefix, today: todayISO() };
}

async function snapshot(page: Page) {
  const response = await page.request.get("/api/my-tasks");
  expect(response.status()).toBe(200);
  return await response.json() as MyTaskSnapshot;
}

async function openMyTasks(page: Page) {
  await page.goto("/my-tasks", { waitUntil: "networkidle" });
  await expect(page.locator("[data-my-tasks-view]")).toHaveAttribute("data-my-task-saving", "false");
}

async function drop(page: Page, taskId: number, bucket: string) {
  const transfer = await page.evaluateHandle((id) => {
    const data = new DataTransfer();
    data.setData("text/my-task", String(id));
    return data;
  }, taskId);
  try {
    await page.locator(`[data-my-task-row="${taskId}"]`).dispatchEvent("dragstart", { dataTransfer: transfer });
    const target = page.locator(`[data-my-task-bucket="${bucket}"]`);
    await target.dispatchEvent("dragover", { dataTransfer: transfer });
    await target.dispatchEvent("drop", { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
}

test("EV03 501 assigned tasks reorder with one relative move and unchanged dates/versions", async ({ page }) => {
  test.setTimeout(90_000);
  const f = await fixture(page);
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = ["セクション,種別,名前,完了,担当者,開始日,期日,進捗,Status,繰返し,コメント",
    ...Array.from({ length: 501 }, (_, index) =>
      ["EV03", "タスク", `${f.prefix} task ${index}`, "", f.me.name, "", f.today, "", "", "", ""].map(cell).join(",")),
  ].join("\n");
  const imported = await page.request.post(`/api/projects/${f.id}/import`, {
    multipart: { file: { name: "ev03.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } }, timeout: 45_000,
  });
  expect(imported.status()).toBe(201);
  expect(await imported.json()).toMatchObject({ created: 501, skipped: 0 });
  const previous = await snapshot(page);
  expect(previous.items.length).toBeGreaterThan(500);
  await openMyTasks(page);
  const view = page.locator("[data-my-tasks-view]");
  const bucket = page.locator('[data-my-task-bucket="today"]');
  const rows = await bucket.locator("[data-my-task-row]").evaluateAll((elements) => elements.map((element) => ({
    id: Number(element.getAttribute("data-my-task-row")), name: element.querySelector("a")?.textContent ?? "",
  })));
  const pairIndex = rows.findIndex((row, index) => index > 0 && row.name.startsWith(f.prefix) && rows[index - 1].name.startsWith(f.prefix));
  expect(pairIndex, "the imported fixture has two adjacent rows within one bucket").toBeGreaterThan(0);
  const a = rows[pairIndex - 1].id;
  const b = rows[pairIndex].id;
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/my-tasks" && res.request().method() === "PUT");
  await page.locator(`[data-my-task-row="${b}"]`).hover();
  await page.locator(`[data-my-task-up="${b}"]`).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).toEqual({ move: { task_id: b, before_task_id: a } });
  await expect(view).toHaveAttribute("data-my-task-saving", "false");
  const after = await snapshot(page);
  const ownIds = new Set(rows.filter((row) => row.name.startsWith(f.prefix)).map((row) => row.id));
  const byId = (state: MyTaskSnapshot) => state.items.filter((item) => ownIds.has(item.task_id)).sort((x, y) => x.task_id - y.task_id);
  expect(byId(after)).toEqual(byId(previous));
  expect(after.items.findIndex((item) => item.task_id === b)).toBeLessThan(after.items.findIndex((item) => item.task_id === a));
  await page.reload({ waitUntil: "networkidle" });
  const persisted = await page.locator('[data-my-task-bucket="today"] [data-my-task-row]').evaluateAll((elements) =>
    elements.map((element) => Number(element.getAttribute("data-my-task-row"))));
  expect(persisted.indexOf(b)).toBeLessThan(persisted.indexOf(a));
  await expect(page.locator("[data-my-task-order-limit]")).toHaveCount(0);
});

test("EV03 bucket dates use versioned PATCH, block duplicate drops and recover from concurrent edits", async ({ page }) => {
  test.setTimeout(60_000);
  const f = await fixture(page);
  const created = await page.request.post("/api/tasks", { data: {
    project_id: f.id, name: `${f.prefix} movable`, assignee_id: f.me.id,
  } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: number };
  const initial = (await snapshot(page)).items.find((item) => item.task_id === id)!;
  await openMyTasks(page);
  const view = page.locator("[data-my-tasks-view]");
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if ((path === `/api/tasks/${id}` && req.method() === "PATCH") || (path === "/api/my-tasks" && req.method() === "PUT")) {
      requests.push({ method: req.method(), body: req.postDataJSON() as Record<string, unknown> });
    }
  });
  let release = () => {};
  let held = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pattern = `**/api/tasks/${id}`;
  const holdFirst = async (route: Route) => {
    if (route.request().method() === "PATCH" && !held) {
      held = true;
      await gate;
    }
    await route.continue();
  };
  await page.route(pattern, holdFirst);
  try {
    await drop(page, id, "today");
    await expect.poll(() => held).toBe(true);
    await expect(view).toHaveAttribute("data-my-task-saving", "true");
    await drop(page, id, "week");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ method: "PATCH", body: { due_on: f.today, expected_updated_at: initial.updated_at } });
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(view).toHaveAttribute("data-my-task-saving", "false");
  expect(requests.map((req) => req.method)).toEqual(["PATCH", "PUT"]);
  await expect(page.locator(`[data-my-task-row="${id}"]`)).toHaveAttribute("data-my-task-due", f.today);
  const fresh = (await snapshot(page)).items.find((item) => item.task_id === id)!;
  expect(fresh.updated_at).not.toBe(initial.updated_at);
  await drop(page, id, "week");
  await expect(view).toHaveAttribute("data-my-task-saving", "false");
  expect(requests[2]).toEqual({ method: "PATCH", body: { due_on: shiftDay(f.today, 3), expected_updated_at: fresh.updated_at } });
  const last = (await snapshot(page)).items.find((item) => item.task_id === id)!;
  const externalDue = shiftDay(f.today, 10);
  const start = requests.length;
  let releaseConflict = () => {};
  let conflictHeld = false;
  const conflictGate = new Promise<void>((resolve) => { releaseConflict = resolve; });
  const holdConcurrent = async (route: Route) => {
    if (route.request().method() === "PATCH") {
      conflictHeld = true;
      await conflictGate;
    }
    await route.continue();
  };
  await page.route(pattern, holdConcurrent);
  const conflict = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/tasks/${id}` && res.request().method() === "PATCH" && res.status() === 409);
  try {
    await drop(page, id, "today");
    await expect.poll(() => conflictHeld).toBe(true);
    const changed = await page.request.patch(`/api/tasks/${id}`, { data: {
      due_on: externalDue, expected_updated_at: last.updated_at,
    } });
    expect(changed.status()).toBe(200);
  } finally {
    releaseConflict();
    await page.unrouteAll({ behavior: "wait" });
  }
  await conflict;
  await expect(view).toHaveAttribute("data-my-task-saving", "false");
  expect(requests.slice(start).map((req) => req.method), "a rejected date never submits an order move").toEqual(["PATCH"]);
  await expect(page.locator("[data-inline-error]")).toContainText("他の場所で更新");
  const row = page.locator(`[data-my-task-row="${id}"]`);
  await expect(row).toHaveAttribute("data-my-task-due", externalDue);
  await expect(row).toHaveAttribute("data-my-task-bucket-key", "later");
  expect((await snapshot(page)).items.find((item) => item.task_id === id)?.due_on).toBe(externalDue);
  const orderPattern = "**/api/my-tasks";
  const failOrder = async (route: Route) => {
    if (route.request().method() === "PUT") await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"simulated order failure"}' });
    else await route.continue();
  };
  await page.route(orderPattern, failOrder);
  try {
    await drop(page, id, "today");
    await expect(view).toHaveAttribute("data-my-task-saving", "false");
    await expect(page.locator("[data-inline-error]")).toContainText("期日は更新しましたが、並び順を保存できませんでした");
    await expect(row).toHaveAttribute("data-my-task-due", f.today);
    expect((await snapshot(page)).items.find((item) => item.task_id === id)?.due_on).toBe(f.today);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
});
