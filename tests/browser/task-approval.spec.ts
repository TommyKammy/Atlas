import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import type { TaskApprovalResponse } from "../../lib/task-approval";

const password = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const projectsToRemove = new WeakMap<Page, number>();

test.afterEach(async ({ page }, info) => {
  // Teardown gets its own bounded budget. A failed locator must remain the
  // primary error even if a timed-out test has already closed its request context.
  info.setTimeout(10_000);
  const projectId = projectsToRemove.get(page);
  if (projectId === undefined) return;
  try {
    const response = await page.request.delete(`/api/projects/${projectId}`, { timeout: 5_000 });
    expect(response.status()).toBe(200);
  } catch (error) {
    if (info.status === info.expectedStatus) throw error;
    info.annotations.push({ type: "cleanup", description: `Project cleanup after the original failure: ${String(error)}` });
  }
});

async function login(context: BrowserContext, email: string) {
  const response = await context.request.post("/api/auth/login", { data: { email, password } });
  expect(response.ok()).toBeTruthy();
}

async function actor(browser: Browser, email: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await login(context, email);
  return { context, page: await context.newPage() };
}

async function fixture(page: Page) {
  await login(page.context(), process.env.E2E_EMAIL ?? "admin@example.com");
  const name = `Approval browser ${test.info().testId} ${Date.now()}`;
  const created = await page.request.post("/api/projects", { data: { workspace_id: 1, name } });
  expect(created.status()).toBe(201);
  const { id: projectId } = await created.json() as { id: number };
  projectsToRemove.set(page, projectId);
  for (const [user_id, role] of [[2, "editor"], [3, "viewer"]] as const) {
    const member = await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id, role } });
    expect(member.status()).toBe(201);
  }
  const taskName = `Review ${name}`;
  const createdTask = await page.request.post("/api/tasks", { data: { project_id: projectId, name: taskName } });
  expect(createdTask.status()).toBe(201);
  const { id: taskId } = await createdTask.json() as { id: number };
  return { projectId, taskId, taskName, api: `/api/tasks/${taskId}/approval`,
    path: `/projects/${projectId}?view=list&task=${taskId}&approval=1` };
}

async function detail(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok()).toBeTruthy();
  return await response.json() as TaskApprovalResponse;
}

async function requestApproval(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  const current = await detail(page, f.api);
  const response = await page.request.post(f.api, { data: { action: "request", approver_id: 2,
    expected_version: 0, expected_updated_at: current.task_updated_at } });
  expect(response.status()).toBe(200);
}

async function section(page: Page, path: string) {
  await page.goto(path);
  const approval = page.locator("[data-task-approval]");
  await expect(approval).toBeVisible();
  await expect(approval).toHaveAttribute("aria-busy", "false");
  return approval;
}

test("request, changes requested, revised resubmission and approval show targeted inbox notices and history", async ({ page, browser }) => {
  const f = await fixture(page);
  const approver = await actor(browser, "tanaka@example.com");
  try {
    await page.setViewportSize({ width: 820, height: 900 });
    let pane = await section(page, f.path);
    await pane.getByRole("searchbox", { name: "承認者を検索", exact: true }).fill("田中");
    await pane.getByRole("combobox", { name: "承認者", exact: true }).selectOption("2");
    const pending = page.waitForResponse((response) => response.url().endsWith(f.api) && response.request().method() === "POST");
    await pane.getByRole("button", { name: "承認を申請", exact: true }).click();
    expect((await pending).status()).toBe(200);
    await expect(pane.locator('[data-approval-status="pending"]')).toBeVisible();
    await expect(pane.getByRole("button", { name: "承認する", exact: true })).toHaveCount(0);

    await approver.page.goto("/inbox");
    const notice = approver.page.getByRole("link", { name: f.taskName, exact: true }).first();
    await expect(notice).toBeVisible();
    await notice.click();
    const review = approver.page.locator("[data-task-approval]");
    await expect(review.getByRole("button", { name: "差し戻す", exact: true })).toBeEnabled();
    await review.getByRole("button", { name: "差し戻す", exact: true }).click();
    const reason = review.getByRole("textbox", { name: "承認のコメント・理由", exact: true });
    await expect(reason).toBeFocused();
    await expect(review.getByRole("alert")).toContainText("理由");
    expect((await detail(approver.page, f.api)).approval?.status).toBe("pending");
    await reason.fill("見積もりの根拠を追記してください");
    const returned = approver.page.waitForResponse((response) => response.url().endsWith(f.api) && response.request().method() === "POST");
    await review.getByRole("button", { name: "差し戻す", exact: true }).click();
    expect((await returned).status()).toBe(200);
    await expect(review.locator('[data-approval-status="changes_requested"]')).toBeVisible();

    // Revise the task through the normal API, then reopen to review that version.
    const revised = await page.request.patch(`/api/tasks/${f.taskId}`, { data: { description: "見積もり根拠を追記しました" } });
    expect(revised.ok()).toBeTruthy();
    pane = await section(page, f.path);
    await pane.getByRole("textbox", { name: "承認のコメント・理由", exact: true }).fill("見積もりを更新しました");
    const resubmitted = page.waitForResponse((response) => response.url().endsWith(f.api) && response.request().method() === "POST");
    await pane.getByRole("button", { name: "再申請する", exact: true }).click();
    expect((await resubmitted).status()).toBe(200);
    await expect(pane).toContainText("第2回");

    const refreshed = await section(approver.page, f.path);
    await refreshed.getByRole("textbox", { name: "承認のコメント・理由", exact: true }).fill("修正を確認しました");
    const approved = approver.page.waitForResponse((response) => response.url().endsWith(f.api) && response.request().method() === "POST");
    await refreshed.getByRole("button", { name: "承認する", exact: true }).click();
    expect((await approved).status()).toBe(200);
    await expect(refreshed.locator('[data-approval-status="approved"]')).toBeVisible();
    await refreshed.getByText("承認履歴（4件）", { exact: true }).click();
    const history = refreshed.locator("[data-approval-history]");
    await expect(history.locator("li")).toHaveCount(4);
    await expect(history.locator('[data-approval-history-action="request_changes"]')).toContainText("見積もりの根拠を追記してください");
    await expect(history.locator('[data-approval-history-action="approve"]')).toContainText("修正を確認しました");
    const final = await detail(page, f.api);
    expect(final.approval?.status).toBe("approved");
    expect(final.approval?.round).toBe(2);
    expect(final.history.map((entry) => entry.action)).toEqual(["request", "request_changes", "resubmit", "approve"]);
    await expect(approver.page.getByRole("button", { name: "承認の操作を開く", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(refreshed.getByText("承認情報を読み込んでいます…", { exact: true })).toHaveCount(0, { timeout: 5_000 });
    await expect(refreshed).toHaveAttribute("aria-busy", "false");
    await approver.page.screenshot({ path: test.info().outputPath("approval-resubmitted-approved.png") });
  } finally {
    await approver.context.close();
  }
});

test("the conversion menu opens approval setup and an ordinary viewer cannot decide", async ({ page, browser }) => {
  const f = await fixture(page);
  const viewer = await actor(browser, "sato@example.com");
  try {
    // Loading a pane first gives an observable client-loaded surface before the
    // document context-menu listener is exercised.
    await section(page, f.path);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-task-approval]")).toHaveCount(0);
    const row = page.locator(`[data-list-row="${f.taskId}"]`);
    await row.getByText(f.taskName, { exact: true }).click({ button: "right" });
    // The submenu's decorative arrow is part of its current accessible name.
    await page.getByRole("menuitem", { name: /^変換先(?:\s*›)?$/ }).hover({ timeout: 5_000 });
    await page.getByRole("menuitem", { name: "承認リクエスト", exact: true }).click({ timeout: 5_000 });
    await expect(page).toHaveURL(/approval=1/);
    const settings = page.locator("[data-task-approval]");
    await expect(settings.getByRole("combobox", { name: "承認者", exact: true })).toBeVisible();
    await settings.getByRole("combobox", { name: "承認者", exact: true }).selectOption("2");
    await settings.getByRole("button", { name: "承認を申請", exact: true }).click();
    await expect(settings.locator('[data-approval-status="pending"]')).toBeVisible();

    const readonly = await section(viewer.page, f.path);
    await expect(readonly.locator('[data-approval-status="pending"]')).toBeVisible();
    await expect(readonly.getByRole("button", { name: "承認する", exact: true })).toHaveCount(0);
    await expect(readonly.getByRole("button", { name: "却下する", exact: true })).toHaveCount(0);
    await expect(readonly.getByRole("button", { name: "差し戻す", exact: true })).toHaveCount(0);
    await expect(readonly.getByRole("button", { name: "承認者を変更", exact: true })).toHaveCount(0);
  } finally {
    await viewer.context.close();
  }
});

test("a failed decision retains its reason and requires an explicit reload before retrying", async ({ page, browser }) => {
  const f = await fixture(page);
  await requestApproval(page, f);
  const approver = await actor(browser, "tanaka@example.com");
  try {
    const pane = await section(approver.page, f.path);
    const reason = pane.getByRole("textbox", { name: "承認のコメント・理由", exact: true });
    await reason.fill("入力した判断理由を保持する");
    const matcher = `**${f.api}`;
    const reject = async (route: Route) => {
      if (route.request().method() === "POST") await route.fulfill({ status: 409, json: { error: "stale approval version" } });
      else await route.continue();
    };
    await approver.page.route(matcher, reject);
    const rejected = approver.page.waitForResponse((response) => response.url().endsWith(f.api) && response.request().method() === "POST");
    await pane.getByRole("button", { name: "差し戻す", exact: true }).click();
    expect((await rejected).status()).toBe(409);
    await expect(reason).toHaveValue("入力した判断理由を保持する");
    await expect(pane.getByRole("alert")).toContainText("先に更新");
    await expect(pane.getByRole("button", { name: "承認する", exact: true })).toBeDisabled();
    await expect(pane.getByRole("button", { name: "差し戻す", exact: true })).toBeDisabled();
    expect((await detail(page, f.api)).approval?.status).toBe("pending");
    await approver.page.unroute(matcher, reject);
    await pane.getByRole("button", { name: "最新の承認情報を読み込む", exact: true }).click();
    await expect(pane.getByRole("button", { name: "差し戻す", exact: true })).toBeEnabled();
    await expect(reason).toHaveValue("入力した判断理由を保持する");
    const accepted = approver.page.waitForResponse((response) => response.url().endsWith(f.api) && response.request().method() === "POST");
    await pane.getByRole("button", { name: "差し戻す", exact: true }).click();
    expect((await accepted).status()).toBe(200);
    await expect(pane.locator('[data-approval-status="changes_requested"]')).toBeVisible();
  } finally {
    await approver.context.close();
  }
});

test("a committed decision with a lost response stays fenced through live refresh until explicit confirmation", async ({ page, browser }) => {
  const f = await fixture(page);
  await requestApproval(page, f);
  const approver = await actor(browser, "tanaka@example.com");
  let releaseReads = () => {};
  let releaseExplicitRead = () => {};
  try {
    const pane = await section(approver.page, f.path);
    await approver.page.bringToFront();
    const reason = pane.getByRole("textbox", { name: "承認のコメント・理由", exact: true });
    const explanation = "サーバーで判断済みでも、失われた応答から成功を推測しない";
    await reason.fill(explanation);
    let postCount = 0;
    let committed!: TaskApprovalResponse;
    approver.page.on("request", (request) => {
      if (request.url().endsWith(f.api) && request.method() === "POST") postCount++;
    });
    const matcher = `**${f.api}`;
    const readGate = new Promise<void>((resolve) => { releaseReads = resolve; });
    let holdReads = true;
    const loseReply = async (route: Route) => {
      if (route.request().method() !== "POST") {
        // Hold live refreshes until the lost-response state has been observed.
        // This forces both sides of the race without relying on event timing.
        if (holdReads) await readGate;
        await route.continue();
        return;
      }
      // Let the real transaction commit. Only its response to the browser is lost.
      const response = await route.fetch({ timeout: 10_000 });
      expect(response.status()).toBe(200);
      committed = await response.json() as TaskApprovalResponse;
      await route.abort("failed");
    };
    await approver.page.route(matcher, loseReply);
    await pane.getByRole("button", { name: "承認する", exact: true }).click();
    await expect(pane.getByRole("alert")).toContainText("結果を確認できませんでした");
    expect(committed.approval?.status).toBe("approved");
    await expect(reason).toHaveValue(explanation);
    await expect(pane.getByRole("button", { name: "承認する", exact: true })).toBeDisabled();
    const latest = pane.getByRole("button", { name: "最新の承認情報を読み込む", exact: true });
    // An intentionally held background GET may keep this disabled while loading.
    // Its presence is required now; enablement is checked after that GET completes.
    await expect(latest).toBeVisible();
    const onServer = await detail(page, f.api);
    expect(onServer.approval?.status).toBe("approved");
    expect(onServer.history.filter((entry) => entry.action === "approve")).toHaveLength(1);

    // A later ordinary edit causes real live invalidation and a background read.
    // That successful read must keep the explicit-confirmation affordance usable.
    const backgroundRead = approver.page.waitForResponse((response) => response.url().endsWith(f.api)
      && response.request().method() === "GET" && response.status() === 200, { timeout: 10_000 });
    const updated = await page.request.patch(`/api/tasks/${f.taskId}`, { data: { name: `${f.taskName} updated` } });
    expect(updated.status()).toBe(200);
    holdReads = false;
    releaseReads();
    await backgroundRead;
    await approver.page.unrouteAll({ behavior: "wait" });
    // Wait for the actual RSC task props, not merely a GET that can observe the
    // new stamp before that RSC response reaches the pane.
    const title = approver.page.locator('[data-task-draft-field="name"]');
    await expect(title).toHaveValue(`${f.taskName} updated`);
    await approver.page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(pane).toHaveAttribute("aria-busy", "false");
    await expect(pane.getByRole("alert")).toContainText("最新");
    await expect(latest).toBeEnabled();

    let arrived!: () => void;
    let readCount = 0;
    const explicitArrived = new Promise<void>((resolve) => { arrived = resolve; });
    const explicitGate = new Promise<void>((resolve) => { releaseExplicitRead = resolve; });
    const failedReads: string[] = [];
    approver.page.on("requestfailed", (request) => {
      if (request.url().endsWith(f.api) && request.method() === "GET") failedReads.push(request.failure()?.errorText ?? "failed");
    });
    await approver.page.route(matcher, async (route) => {
      if (route.request().method() === "GET" && ++readCount === 1) {
        arrived();
        await explicitGate;
      }
      await route.continue();
    });
    await latest.click();
    await explicitArrived;
    // Deliver a second, real task invalidation while the explicit read is held.
    // It must queue a background read rather than abort the explicit request.
    const secondName = `${f.taskName} updated during explicit confirmation`;
    expect((await page.request.patch(`/api/tasks/${f.taskId}`, { data: { name: secondName } })).status()).toBe(200);
    await expect(title).toHaveValue(secondName);
    await approver.page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(readCount).toBe(1);
    expect(failedReads).toEqual([]);
    releaseExplicitRead();
    await expect.poll(() => readCount).toBe(2);
    await expect(pane).toHaveAttribute("aria-busy", "false");
    await expect(pane.getByRole("alert")).toHaveCount(0);
    expect(failedReads).toEqual([]);
    await approver.page.unrouteAll({ behavior: "wait" });
    await expect(pane.locator('[data-approval-status="approved"]')).toBeVisible();
    for (const name of ["承認する", "却下する", "差し戻す", "再申請する"]) {
      await expect(pane.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await pane.getByText("承認履歴（2件）", { exact: true }).click();
    await expect(pane.locator('[data-approval-history-action="approve"]')).toHaveCount(1);
    await expect(pane.locator('[data-approval-history-action="approve"]')).toContainText(explanation);
    expect(postCount).toBe(1);
    expect((await detail(page, f.api)).approval?.version).toBe(2);
  } finally {
    releaseReads();
    releaseExplicitRead();
    await approver.page.unrouteAll({ behavior: "wait" });
    await approver.context.close();
  }
});
