import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

type InboxSnapshot = { total: number; unread: number; read: number; all: number; items: { entry: string; id: number }[]; nextCursor: string | null };
type Fixture = { projectId: number; userId: number; taskId: number; context: BrowserContext; inbox: Page };
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

async function snapshot(context: BrowserContext, filter = "unread"): Promise<InboxSnapshot> {
  const response = await context.request.get(`/api/inbox?filter=${filter}`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<InboxSnapshot>;
}

async function fixture(page: Page, browser: Browser): Promise<Fixture> {
  const credentials = { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" };
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  const token = randomUUID();
  const email = `ev10-${token}@example.com`;
  const password = "Ev10-Isolated-2026!";
  const actor = await page.request.post("/api/admin/users", { data: { name: `EV10 recipient ${token}`, email, password, role: "member" } });
  expect(actor.status()).toBe(201);
  const { id: userId } = await actor.json() as { id: number };
  const project = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `EV10 inbox ${token}` } });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const f = { userId, projectId, taskId: 0, context, inbox: await context.newPage() };
  fixtures.set(page, f);
  expect((await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: userId, role: "commenter" } })).status()).toBe(201);
  const created = await page.request.post("/api/tasks", { data: { project_id: projectId, name: "EV10 isolated notification task" } });
  expect(created.status()).toBe(201);
  f.taskId = (await created.json() as { id: number }).id;
  expect((await context.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  // This actor belongs only to this fixture; existing task-create events are a
  // measured read baseline, not assumptions about seed/global inbox counts.
  expect((await context.request.post("/api/inbox/read", { data: { all: true, workspace_id: 1 } })).status()).toBe(200);
  expect((await snapshot(context)).unread).toBe(0);
  return f;
}

async function comment(page: Page, taskId: number, body: string) {
  const response = await page.request.post("/api/comments", { data: { task_id: taskId, body } });
  expect(response.status()).toBe(201);
  return (await response.json() as { id: number }).id;
}

async function entries(page: Page) {
  return page.locator("[data-inbox-entry]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-inbox-entry")!));
}

async function openNotifications(page: Page, projectId: number) {
  await page.goto(`/projects/${projectId}?view=list`);
  await page.locator("[data-project-actions-button]").click();
  await page.locator('[data-project-action="settings"]').click();
  const dialog = page.locator("[data-project-settings-dialog]");
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-project-settings-tab="notifications"]').click();
  const panel = dialog.locator('[data-project-settings-panel="notifications"]');
  await expect(panel.locator("[data-notification-email-status]")).not.toHaveAttribute("data-notification-email-status", "unknown");
  return { dialog, panel };
}

test("EV10 isolated inbox reaches 51 comments, marks reads and navigates unread/read/all without duplicates", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const f = await fixture(page, browser);
  const baseline = await snapshot(f.context, "all");
  const commentIds: number[] = [];
  for (let i = 0; i < 51; i++) commentIds.push(await comment(page, f.taskId, `EV10 notification ${i}`));
  await f.inbox.goto("/inbox");
  await expect(f.inbox.locator('[data-inbox-filter="unread"]')).toHaveAttribute("aria-current", "page");
  await expect(f.inbox.locator('[data-inbox-filter="unread"]')).toHaveText("未読（51）");
  await expect(f.inbox.locator("[data-inbox-total]")).toHaveAttribute("data-inbox-total", "51");
  const first = await entries(f.inbox);
  expect(first).toHaveLength(50);
  await f.inbox.locator("[data-inbox-next]").focus();
  await f.inbox.keyboard.press("Enter");
  const last = f.inbox.locator("[data-inbox-entry]");
  await expect(last).toHaveCount(1);
  const second = await entries(f.inbox);
  expect(new Set([...first, ...second])).toEqual(new Set(commentIds.map((id) => `comment-${id}`)));
  await expect(f.inbox.locator("[data-inbox-next]")).toHaveCount(0);
  const markedEntry = second[0];
  const marking = f.inbox.waitForResponse((response) => new URL(response.url()).pathname === "/api/inbox/read" && response.request().method() === "POST");
  await last.getByRole("button", { name: "既読にする", exact: true }).click();
  expect((await marking).status()).toBe(200);
  await expect(f.inbox.locator('[data-inbox-filter="unread"]')).toHaveText("未読（50）");
  await f.inbox.locator("[data-inbox-first]").click();
  await expect(f.inbox.locator("[data-inbox-entry]")).toHaveCount(50);
  await expect(f.inbox.locator("[data-inbox-next]")).toHaveCount(0);

  await f.inbox.locator('[data-inbox-filter="read"]').click();
  await expect(f.inbox.locator('[data-inbox-filter="read"]')).toHaveAttribute("aria-current", "page");
  await expect(f.inbox.locator("[data-inbox-total]")).toHaveAttribute("data-inbox-total", String(baseline.read + 1));
  await expect(f.inbox.locator(`[data-inbox-entry="${markedEntry}"]`)).toBeVisible();
  const own = await comment(f.inbox, f.taskId, "EV10 own post belongs in read and all");
  await f.inbox.locator('[data-inbox-filter="all"]').click();
  await expect(f.inbox.locator('[data-inbox-filter="all"]')).toHaveAttribute("aria-current", "page");
  await expect(f.inbox.locator("[data-inbox-total]")).toHaveAttribute("data-inbox-total", String(baseline.all + 52));
  await expect(f.inbox.locator('[data-inbox-filter="unread"]')).toHaveText("未読（50）");
  await expect(f.inbox.locator(`[data-inbox-entry="comment-${own}"]`).getByRole("button", { name: "既読にする", exact: true })).toHaveCount(0);
  const allFirst = await entries(f.inbox);
  await f.inbox.locator("[data-inbox-next]").click();
  await expect(f.inbox.locator("[data-inbox-next]")).toHaveCount(0);
  const allLast = await entries(f.inbox);
  expect(new Set([...allFirst, ...allLast]).size).toBe(baseline.all + 52);

  await f.inbox.locator('[data-inbox-filter="read"]').click();
  await expect(f.inbox.locator("[data-inbox-total]")).toHaveAttribute("data-inbox-total", String(baseline.read + 2));
  await expect(f.inbox.locator(`[data-inbox-entry="comment-${own}"]`)).toBeVisible();
  await f.inbox.locator('[data-inbox-filter="unread"]').click();
  const allMarking = f.inbox.waitForResponse((response) => new URL(response.url()).pathname === "/api/inbox/read" && response.request().method() === "POST");
  await f.inbox.getByRole("button", { name: "すべて既読にする", exact: true }).click();
  expect((await allMarking).status()).toBe(200);
  await expect(f.inbox.locator('[data-inbox-filter="unread"]')).toHaveText("未読（0）");
  await expect(f.inbox.getByText("未読はありません。", { exact: true })).toBeVisible();
});

test("EV10 project notification settings explain email delivery state and hide in-app notifications when disabled", async ({ page, browser }) => {
  const f = await fixture(page, browser);
  await comment(page, f.taskId, "EV10 notification before disabling");
  expect((await snapshot(f.context)).unread).toBe(1);
  const settingsResponse = await page.request.get(`/api/projects/${f.projectId}/settings`);
  expect(settingsResponse.status()).toBe(200);
  const settings = await settingsResponse.json() as { notification_delivery: { smtp_configured: boolean; worker_running: boolean } };
  const { dialog, panel } = await openNotifications(page, f.projectId);
  const status = panel.locator("[data-notification-email-status]");
  const delivery = settings.notification_delivery;
  if (!delivery.smtp_configured) {
    await expect(status).toHaveAttribute("data-notification-email-status", "unconfigured");
    await expect(status).toContainText("SMTPまたはアプリの公開URLが未設定");
    await expect(status).toContainText("タスクの変更は保存されます");
    await expect(panel.locator("[data-notification-email-retry]")).toBeDisabled();
  } else if (!delivery.worker_running) {
    await expect(status).toHaveAttribute("data-notification-email-status", "worker_stopped");
    await expect(status).toContainText("配信ワーカーが動作していません");
    await expect(panel.locator("[data-notification-email-retry]")).toBeDisabled();
  } else {
    await expect(status).toHaveAttribute("data-notification-email-status", "ready");
    await expect(status).toContainText("実際の接続・受付結果は各メールの送信時に確認します");
  }
  await expect(panel).toContainText("保存後に設定が反映されます");
  const inApp = panel.getByRole("checkbox", { name: /アプリ内通知/ });
  await expect(inApp).toBeChecked();
  await inApp.uncheck();
  const saving = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/projects/${f.projectId}` && response.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  expect((await saving).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await comment(page, f.taskId, "EV10 notification while disabled");
  const hidden = await snapshot(f.context, "all");
  expect(hidden).toMatchObject({ total: 0, all: 0, unread: 0, read: 0, items: [] });
  await f.inbox.goto("/inbox?filter=all");
  await expect(f.inbox.locator("[data-inbox-total]")).toHaveAttribute("data-inbox-total", "0");
  await expect(f.inbox.locator('[data-inbox-filter="unread"]')).toHaveText("未読（0）");
  await expect(f.inbox.locator("[data-inbox-entry]")).toHaveCount(0);
  const reopened = await openNotifications(page, f.projectId);
  await expect(reopened.panel.getByRole("checkbox", { name: /アプリ内通知/ })).not.toBeChecked();
});
