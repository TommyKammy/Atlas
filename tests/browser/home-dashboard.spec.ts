import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { shiftDay } from "../../lib/calendar";
import { todayISO } from "../../lib/dates";

test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 15_000 });

const ADMIN = { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" };
const REVIEWER = { email: "sato@example.com", password: "atlas-dev-2026" };
const APPROVER = { email: "tanaka@example.com", password: "atlas-dev-2026" };
const RUN = randomUUID().slice(0, 8);
const PASSWORD = `Atlas-Home-${RUN}!`;
const SECRET_INITIATIVE = `非表示の案件 ${RUN}`;

type Fixture = {
  adminId: number;
  member: { id: number; name: string; email: string };
  empty: { id: number; name: string; email: string };
  reviewerId: number;
  approverId: number;
  agendaProject: { id: number; name: string };
  progressProject: { id: number; name: string };
  emptyProject: { id: number; name: string };
  tasks: {
    overdue: number;
    today: number;
    weekInProgress: number;
    completedParent: number;
    outsideWeek: number;
    undated: number;
    subtask: number;
  };
  portfolio: { id: number; name: string; periodId: number; proposalId: number };
};

let fixture: Fixture;

async function expectJson<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

async function login(request: APIRequestContext, user: { email: string; password: string; }) {
  const response = await request.post("/api/auth/login", { data: user });
  expect(response.status(), `${user.email} login ${await response.text()}`).toBe(200);
}

async function createProject(request: APIRequestContext, name: string): Promise<number> {
  const response = await request.post("/api/projects", { data: { workspace_id: 1, name } });
  return (await expectJson<{ id: number }>(response, 201)).id;
}

async function addEditor(request: APIRequestContext, projectId: number, userId: number) {
  const response = await request.post(`/api/projects/${projectId}/members`, {
    data: { user_id: userId, role: "editor" },
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function createTask(
  request: APIRequestContext,
  projectId: number,
  name: string,
  due: string | null,
  assigneeId: number,
  options: { completed?: boolean; progress?: number; parentId?: number } = {},
): Promise<number> {
  const response = await request.post("/api/tasks", {
    data: {
      project_id: projectId,
      name,
      due_on: due,
      assignee_id: assigneeId,
      ...(options.parentId ? { parent_task_id: options.parentId } : {}),
    },
  });
  const { id } = await expectJson<{ id: number }>(response, 201);
  if (options.progress !== undefined || options.completed) {
    const patch = await request.patch(`/api/tasks/${id}`, {
      data: {
        ...(options.progress !== undefined ? { progress: options.progress } : {}),
        ...(options.completed ? { completed: true } : {}),
      },
    });
    expect(patch.status(), await patch.text()).toBe(200);
  }
  return id;
}

async function createUser(request: APIRequestContext, role: "member", name: string) {
  const email = `home-${role}-${RUN}-${name.replace(/\s/g, "").toLowerCase()}@example.test`;
  const response = await request.post("/api/admin/users", {
    data: { name, email, role, password: PASSWORD },
  });
  const body = await expectJson<{ id: number }>(response, 201);
  return { id: body.id, name, email };
}

async function loadDirectory(request: APIRequestContext) {
  const response = await request.get("/api/users");
  return (await expectJson<{ users: { id: number; email: string | null }[] }>(response, 200)).users;
}

test.beforeAll(async ({ request }) => {
  await login(request, ADMIN);
  const me = await expectJson<{ id: number }>(await request.get("/api/me"), 200);
  const directory = await loadDirectory(request);
  const reviewerId = directory.find((member) => member.email === REVIEWER.email)?.id;
  const approverId = directory.find((member) => member.email === APPROVER.email)?.id;
  if (!reviewerId || !approverId) throw new Error("seed reviewer/approver are missing");

  const member = await createUser(request, "member", `ホーム確認 ${RUN}`);
  const empty = await createUser(request, "member", `ホーム空 ${RUN}`);
  const today = todayISO();

  const agendaProject = { id: await createProject(request, `ホーム期日 ${RUN}`), name: `ホーム期日 ${RUN}` };
  await addEditor(request, agendaProject.id, member.id);
  const tasks = {
    overdue: await createTask(request, agendaProject.id, "期限超過の確認", shiftDay(today, -1), member.id, { progress: 20 }),
    today: await createTask(request, agendaProject.id, "今日が期日の確認", today, member.id),
    weekInProgress: await createTask(request, agendaProject.id, "今週の進行中", shiftDay(today, 3), member.id, { progress: 40 }),
    completedParent: await createTask(request, agendaProject.id, "完了した親タスク", shiftDay(today, -1), member.id, { completed: true }),
    outsideWeek: await createTask(request, agendaProject.id, "来週のタスク", shiftDay(today, 7), member.id),
    undated: await createTask(request, agendaProject.id, "期日なしのタスク", null, member.id),
    subtask: 0,
  };
  tasks.subtask = await createTask(request, agendaProject.id, "期限超過の子タスク", shiftDay(today, -1), member.id, { parentId: tasks.today });
  for (let index = 1; index <= 6; index += 1) {
    await createTask(request, agendaProject.id, `今週の確認 ${index}`, shiftDay(today, index), member.id);
  }

  const progressProject = { id: await createProject(request, `進み具合 ${RUN}`), name: `進み具合 ${RUN}` };
  await addEditor(request, progressProject.id, member.id);
  await createTask(request, progressProject.id, "完了A", shiftDay(today, -10), me.id, { completed: true });
  await createTask(request, progressProject.id, "完了B", shiftDay(today, -9), me.id, { completed: true });
  await createTask(request, progressProject.id, "未完了A", shiftDay(today, -1), me.id);
  await createTask(request, progressProject.id, "未完了B", shiftDay(today, 4), me.id);

  const emptyProject = { id: await createProject(request, `空の進み具合 ${RUN}`), name: `空の進み具合 ${RUN}` };
  await addEditor(request, emptyProject.id, member.id);

  const portfolio = { id: 0, name: `ホーム決裁 ${RUN}`, periodId: 0, proposalId: 0 };
  const created = await expectJson<{ id: number }>(
    await request.post("/api/portfolios", {
      data: { name: portfolio.name, description: "ホームの決裁待ちカードを確認するE2E用ポートフォリオ" },
    }),
    201,
  );
  portfolio.id = created.id;
  for (const userId of [reviewerId, approverId]) {
    const viewer = await request.post(`/api/portfolios/${portfolio.id}/planning/viewers`, {
      data: { userId },
    });
    expect(viewer.status(), await viewer.text()).toBe(200);
  }
  const period = await expectJson<{ periodId: number; revision: number }>(
    await request.post(`/api/portfolios/${portfolio.id}/planning/periods`, {
      data: { year: 2028, quarter: 1, budgetYen: 1_000_000, roles: ["エンジニア"] },
    }),
    201,
  );
  portfolio.periodId = period.periodId;
  const state = await expectJson<{ roles: { id: number }[] }>(
    await request.get(`/api/portfolios/${portfolio.id}/planning`),
    200,
  );
  const roleId = state.roles[0]?.id;
  if (!roleId) throw new Error("planning role was not created");
  const initiative = await expectJson<{ revision: number }>(
    await request.post(`/api/portfolios/${portfolio.id}/planning/initiatives`, {
      data: {
        periodId: period.periodId,
        revision: period.revision,
        name: SECRET_INITIATIVE,
        ownerMemberId: me.id,
        expectedEffect: "ホームにスナップショットを出さないこと",
        kind: "fixed",
        linkedProjectId: null,
        costYen: 100_000,
        demands: [1, 2, 3].map((monthIndex) => ({ roleId, monthIndex, days: 1 })),
      },
    }),
    201,
  );
  const settings = await request.put(`/api/portfolios/${portfolio.id}/planning/approval-settings`, {
    data: { enabled: true, finalApproverUserId: approverId, reviewerUserId: reviewerId },
  });
  expect(settings.status(), await settings.text()).toBe(200);
  const proposal = await expectJson<{ id: number; status: string }>(
    await request.post(`/api/portfolios/${portfolio.id}/planning/proposals`, {
      data: {
        periodId: period.periodId,
        revision: initiative.revision,
        chosenSlot: 1,
        reason: "ホームの決裁待ちカードを確認するための提案です。",
        requestId: randomUUID(),
      },
    }),
    201,
  );
  expect(proposal.status).toBe("under_review");
  portfolio.proposalId = proposal.id;

  fixture = {
    adminId: me.id,
    member,
    empty,
    reviewerId,
    approverId,
    agendaProject,
    progressProject,
    emptyProject,
    tasks,
    portfolio,
  };
});

async function openHome(page: Page, user: { email: string; password: string }) {
  await login(page.request, user);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("[data-home-dashboard]")).toBeVisible();
}

test("home agenda groups assigned parent tasks and keeps completion working", async ({ page }) => {
  await openHome(page, { email: fixture.member.email, password: PASSWORD });
  const agenda = page.locator("[data-home-agenda]");

  await expect(agenda.locator("[data-home-agenda-title]")).toHaveText(
    `${fixture.member.name}さん、今日は 9件です`,
  );
  await expect(agenda.getByText("期限超過 1件 ・ 今日が期日 1件 ・ 今週 7件", { exact: true })).toBeVisible();

  const overdue = agenda.locator(`[data-home-agenda-row="${fixture.tasks.overdue}"]`);
  await expect(overdue).toHaveAttribute("data-home-agenda-state", "overdue");
  await expect(overdue.locator('[data-due-state="overdue"]')).toBeVisible();
  await expect(overdue.getByText("期限超過: ", { exact: true })).toBeAttached();
  await expect(overdue.getByRole("link", { name: "期限超過の確認" })).toHaveAttribute(
    "href",
    `/projects/${fixture.agendaProject.id}?view=list&task=${fixture.tasks.overdue}`,
  );

  const week = agenda.locator('[data-home-agenda-group="week"]');
  await expect(week.locator("[data-home-agenda-row]")).toHaveCount(5);
  await expect(week.getByRole("link", { name: "ほか 2件" })).toHaveAttribute("href", "/my-tasks");
  await expect(
    agenda.locator(`[data-home-agenda-row="${fixture.tasks.weekInProgress}"]`),
  ).toHaveAttribute("data-home-agenda-state", "in-progress");
  await expect(
    agenda.locator(`[data-home-agenda-row="${fixture.tasks.completedParent}"]`),
  ).toHaveCount(0);
  await expect(
    agenda.locator(`[data-home-agenda-row="${fixture.tasks.outsideWeek}"]`),
  ).toHaveCount(0);
  await expect(agenda.locator(`[data-home-agenda-row="${fixture.tasks.undated}"]`)).toHaveCount(0);
  await expect(agenda.locator(`[data-home-agenda-row="${fixture.tasks.subtask}"]`)).toHaveCount(0);

  const todayRow = agenda.locator(`[data-home-agenda-row="${fixture.tasks.today}"]`);
  await expect(todayRow).toHaveAttribute("data-home-agenda-state", "todo");
  const [patchResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return response.request().method() === "PATCH" && pathname === `/api/tasks/${fixture.tasks.today}`;
    }),
    todayRow.getByRole("button", { name: "未着手（完了にする）" }).click(),
  ]);
  expect(patchResponse.status()).toBe(200);
  await expect(agenda.locator("[data-home-agenda-title]")).toHaveText(
    `${fixture.member.name}さん、今日は 8件です`,
  );
  await expect(agenda.locator('[data-home-agenda-group="today"]')).toHaveCount(0);
});

test("progress rows use parent-task completion and the タスクなし wording", async ({ page }) => {
  await login(page.request, { email: fixture.member.email, password: PASSWORD });
  for (const project of [fixture.agendaProject, fixture.progressProject, fixture.emptyProject]) {
    await page.goto(`/projects/${project.id}?view=list`, { waitUntil: "networkidle" });
  }
  await page.goto("/", { waitUntil: "networkidle" });

  const progress = page.locator("[data-home-progress]");
  const projectRow = progress.locator(`[data-home-progress-project="${fixture.progressProject.id}"]`);
  await expect(projectRow).toContainText(fixture.progressProject.name);
  await expect(projectRow).toContainText("50% ・ 超過 1件");
  await expect(projectRow).toHaveAttribute("href", `/projects/${fixture.progressProject.id}?view=list`);
  await expect(
    progress.locator(`[data-home-progress-project="${fixture.emptyProject.id}"]`),
  ).toContainText("タスクなし");
  await expect(
    progress.locator(`[data-home-progress-project="${fixture.agendaProject.id}"]`),
  ).toBeVisible();
});

test("titles and progress bars keep usable width at 1024px and 1440px", async ({ page }) => {
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openHome(page, { email: fixture.member.email, password: PASSWORD });
    const title = page
      .locator(`[data-home-agenda-row="${fixture.tasks.overdue}"]`)
      .getByRole("link", { name: "期限超過の確認" });
    expect((await title.boundingBox())?.width ?? 0, `title width at ${width}px`).toBeGreaterThan(120);
    const bar = page.locator(`[data-home-progress-project="${fixture.progressProject.id}"] .bg-surface-strong`);
    expect((await bar.boundingBox())?.width ?? 0, `progress bar width at ${width}px`).toBeGreaterThan(60);
  }
});

test("a member without tasks or projects sees calm empty states", async ({ page }) => {
  await openHome(page, { email: fixture.empty.email, password: PASSWORD });
  await expect(page.locator("[data-home-agenda-title]")).toHaveText(
    `${fixture.empty.name}さん、今日は 0件です`,
  );
  await expect(page.getByText("期日が近いタスクはありません", { exact: true })).toBeVisible();
  await expect(page.getByText("新しい通知はありません", { exact: true })).toBeVisible();
  await expect(page.getByText("表示できるプロジェクトはありません", { exact: true })).toBeVisible();
});

test("the inbox card shows at most three newest items and links to the inbox", async ({ page }) => {
  await openHome(page, ADMIN);
  const inbox = page.locator("[data-home-inbox]");
  await expect(inbox.getByRole("link", { name: "すべて見る" })).toHaveAttribute("href", "/inbox");
  const items = inbox.locator("[data-home-inbox-item]");
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeLessThanOrEqual(3);
  const first = items.first();
  await expect(first).toHaveAttribute("href", /^\/projects\/\d+\?view=list&task=\d+$/);
  await expect(first.locator("b")).not.toHaveText("");
  await expect(first).toContainText(/(たった今|\d+分前|\d+時間前|\d+日前|\d+年前)$/);
});

test("the decision card follows assignment, stage and plan access", async ({ page }) => {
  await openHome(page, REVIEWER);
  const card = page.locator(`[data-home-decision-proposal="${fixture.portfolio.proposalId}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(fixture.portfolio.name);
  await expect(card).toContainText("2028年 1月–3月");
  await expect(card).toContainText("第1版 ・ レビュー待ち");
  await expect(card).toContainText("管理者");
  await expect(card).toContainText("100万円");
  await expect(card).not.toContainText(SECRET_INITIATIVE);
  const reviewLink = card.getByRole("link", { name: "内容を確認する" });
  await expect(reviewLink).toHaveAttribute(
    "href",
    `/portfolio/${fixture.portfolio.id}/planning?view=compare&period=2028-Q1#proposal-history`,
  );

  await openHome(page, APPROVER);
  await expect(page.locator(`[data-home-decision-proposal="${fixture.portfolio.proposalId}"]`)).toHaveCount(0);

  // People without an assignment never see the card, even inside the workspace.
  await openHome(page, { email: fixture.member.email, password: PASSWORD });
  await expect(page.locator(`[data-home-decision-proposal="${fixture.portfolio.proposalId}"]`)).toHaveCount(0);

  await login(page.request, REVIEWER);
  const reviewed = await page.request.post(
    `/api/portfolios/${fixture.portfolio.id}/planning/proposals/${fixture.portfolio.proposalId}/review`,
    {
      data: {
        action: "pass",
        note: "ホームの決裁待ちカード確認用にレビュー済みにします。",
        expectedStatus: "under_review",
        requestId: randomUUID(),
      },
    },
  );
  expect(reviewed.status(), await reviewed.text()).toBe(200);

  await openHome(page, APPROVER);
  const decision = page.locator(`[data-home-decision-proposal="${fixture.portfolio.proposalId}"]`);
  await expect(decision).toBeVisible();
  await expect(decision).toContainText("第1版 ・ 最終決裁待ち");
  await expect(decision).not.toContainText(SECRET_INITIATIVE);
  const decisionLink = decision.getByRole("link", { name: "内容を確認して決裁する" });
  await expect(decisionLink).toHaveAttribute(
    "href",
    `/portfolio/${fixture.portfolio.id}/planning?view=compare&period=2028-Q1#proposal-history`,
  );
  await decisionLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/portfolio/${fixture.portfolio.id}/planning\\?view=compare&period=2028-Q1#proposal-history$`),
  );
  await expect(page.getByRole("heading", { name: "投資シナリオ比較", exact: true })).toBeVisible();
});

test("the widget grid still adds, reorders and keeps saved layout", async ({ page }) => {
  await openHome(page, { email: fixture.member.email, password: PASSWORD });
  const cards = page.locator("[data-home-widget]");
  await expect(cards.first()).toBeVisible();
  const before = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-home-widget-id")),
  );
  expect(before.length).toBeGreaterThanOrEqual(2);

  await page.locator("[data-home-add-widget-button]").click();
  const panel = page.locator("[data-home-add-widget]");
  await expect(panel).toBeVisible();
  const [addResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return response.request().method() === "POST" && pathname === "/api/home/widgets";
    }),
    panel
      .locator('[data-home-add-widget-type="mentions"]')
      .getByRole("button", { name: "＋ 追加" })
      .click(),
  ]);
  expect(addResponse.status()).toBe(201);
  await expect(page.locator('[data-home-widget-type="mentions"]')).toBeVisible();

  const firstId = before[0];
  const secondId = before[1];
  const firstCard = page.locator(`[data-home-widget-id="${firstId}"]`);
  const secondCard = page.locator(`[data-home-widget-id="${secondId}"]`);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const [reorderResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return response.request().method() === "PATCH" && pathname === "/api/home/widgets";
    }),
    (async () => {
      const handle = secondCard.locator("[data-home-widget-drag-handle]");
      await handle.dispatchEvent("dragstart", { dataTransfer: transfer });
      await firstCard.dispatchEvent("dragover", { dataTransfer: transfer });
      await firstCard.dispatchEvent("drop", { dataTransfer: transfer });
      await handle.dispatchEvent("dragend", { dataTransfer: transfer });
    })(),
  ]);
  await transfer.dispose();
  expect(reorderResponse.status()).toBe(200);
  await expect(page.locator("[data-home-widget]").first()).toHaveAttribute(
    "data-home-widget-id",
    String(secondId),
  );
  const after = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-home-widget-id")),
  );
  expect(after.indexOf(String(secondId))).toBe(0);
  expect(after.indexOf(String(firstId))).toBe(1);
  await page.reload({ waitUntil: "networkidle" });
  const persisted = await page.locator("[data-home-widget]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-home-widget-id")),
  );
  expect(persisted).toEqual(after);

  const widgets = await expectJson<{ widgets: { id: number; widget_type: string }[] }>(
    await page.request.get("/api/home/widgets"),
    200,
  );
  const added = widgets.widgets.find((widget) => widget.widget_type === "mentions");
  if (added) {
    const removed = await page.request.delete(`/api/home/widgets/${added.id}`);
    expect(removed.status(), await removed.text()).toBe(200);
  }
});
