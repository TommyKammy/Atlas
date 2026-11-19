import { expect, test, type APIResponse, type Locator, type Page } from "@playwright/test";

// A missing selector should fail one action, not consume the whole test
// timeout while a controlled form performs a server round-trip.
test.use({ actionTimeout: 15_000 });

/**
 * Layout and state regression for the C workbench investment comparison.
 * Data is created through the product's HTTP APIs; the assertions read the
 * rendered screen (two-column placement, summary numbers, card status words,
 * supply cells, decision panel and the restricted projection).
 */

const ADMIN = { email: "admin@example.com", password: "atlas-dev-2026" };
const REVIEWER = { email: "sato@example.com", password: "atlas-dev-2026" };
const APPROVER = { email: "tanaka@example.com", password: "atlas-dev-2026" };
const REASON =
  "2月のDB担当の不足を解消するため、申請自動化を次期に回し、B案で提出します。";

type DirectoryMember = { id: number; name: string; email: string | null };

type Plan = {
  portfolioId: number;
  periodId: number;
  revision: number;
  roleId: number;
  projectId: number | null;
};

async function expectJson<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

async function login(page: Page, user: { email: string; password: string }): Promise<void> {
  const response = await page.request.post("/api/auth/login", { data: user });
  expect(response.status(), await response.text()).toBe(200);
}

async function loadDirectory(page: Page): Promise<DirectoryMember[]> {
  const response = await page.request.get("/api/users");
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { users: DirectoryMember[] };
  return body.users;
}

async function createPlan(
  page: Page,
  options: {
    approval: boolean;
    viewers?: DirectoryMember[];
    linkedProject?: boolean;
  },
): Promise<Plan> {
  const me = await expectJson<DirectoryMember>(
    await page.request.get("/api/me"),
    200,
  );
  const directory = await loadDirectory(page);
  const reviewerId = directory.find((member) => member.email === REVIEWER.email)?.id;
  const approverId = directory.find((member) => member.email === APPROVER.email)?.id;
  if (options.approval && (!reviewerId || !approverId)) {
    throw new Error("approval fixture users are missing");
  }

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const portfolio = await expectJson<{ id: number }>(
    await page.request.post("/api/portfolios", {
      data: {
        name: `比較レイアウト ${suffix}`,
        description: "投資計画の比較レイアウトを確認するE2E用ポートフォリオ",
      },
    }),
    201,
  );

  let projectId: number | null = null;
  if (options.linkedProject) {
    const project = await expectJson<{ id: number }>(
      await page.request.post("/api/projects", {
        data: { workspace_id: 1, name: `比較レイアウト非公開 ${suffix}` },
      }),
      201,
    );
    projectId = project.id;
    await expectJson(
      await page.request.post(`/api/portfolios/${portfolio.id}/projects`, {
        data: { project_id: project.id },
      }),
      201,
    );
  }

  for (const viewer of options.viewers ?? []) {
    await expectJson(
      await page.request.post(`/api/portfolios/${portfolio.id}/planning/viewers`, {
        data: { userId: viewer.id },
      }),
      200,
    );
  }

  const period = await expectJson<{ periodId: number; revision: number }>(
    await page.request.post(`/api/portfolios/${portfolio.id}/planning/periods`, {
      data: { year: 2027, quarter: 1, budgetYen: 10_000_000, roles: ["DB担当"] },
    }),
    201,
  );
  const state = await expectJson<{ roles: { id: number; name: string }[] }>(
    await page.request.get(`/api/portfolios/${portfolio.id}/planning`),
    200,
  );
  const roleId = state.roles[0]?.id;
  if (!roleId) throw new Error("planning role was not created");

  let revision = period.revision;
  const fixed = await expectJson<{ id: number; revision: number }>(
    await page.request.post(`/api/portfolios/${portfolio.id}/planning/initiatives`, {
      data: {
        periodId: period.periodId,
        revision,
        name: "基盤更改",
        ownerMemberId: me.id,
        expectedEffect: "保守期限までに基盤を移行",
        kind: "fixed",
        linkedProjectId: projectId,
        costYen: 6_000_000,
        demands: [1, 2, 3].map((monthIndex) => ({
          roleId,
          monthIndex,
          days: [12, 5, 3][monthIndex - 1],
        })),
      },
    }),
    201,
  );
  revision = fixed.revision;
  const candidateA = await expectJson<{ id: number; revision: number }>(
    await page.request.post(`/api/portfolios/${portfolio.id}/planning/initiatives`, {
      data: {
        periodId: period.periodId,
        revision,
        name: "申請自動化",
        ownerMemberId: me.id,
        expectedEffect: "申請処理を平均5日から2日に短縮",
        kind: "candidate",
        linkedProjectId: null,
        costYen: 4_000_000,
        demands: [1, 2, 3].map((monthIndex) => ({
          roleId,
          monthIndex,
          days: [10, 4, 2][monthIndex - 1],
        })),
      },
    }),
    201,
  );
  revision = candidateA.revision;
  const candidateB = await expectJson<{ id: number; revision: number }>(
    await page.request.post(`/api/portfolios/${portfolio.id}/planning/initiatives`, {
      data: {
        periodId: period.periodId,
        revision,
        name: "顧客分析",
        ownerMemberId: me.id,
        expectedEffect: "顧客レポートの集計を月20時間削減",
        kind: "candidate",
        linkedProjectId: null,
        costYen: 3_000_000,
        demands: [1, 2, 3].map((monthIndex) => ({
          roleId,
          monthIndex,
          days: [6, 4, 2][monthIndex - 1],
        })),
      },
    }),
    201,
  );
  revision = candidateB.revision;

  const capacity = await expectJson<{ revision: number }>(
    await page.request.put(
      `/api/portfolios/${portfolio.id}/planning/periods/${period.periodId}/capacity`,
      {
        data: {
          revision,
          capacities: [1, 2, 3].map((monthIndex) => ({
            roleId,
            monthIndex,
            days: [18, 18, 16][monthIndex - 1],
          })),
        },
      },
    ),
    200,
  );
  revision = capacity.revision;
  const scenarioA = await expectJson<{ revision: number }>(
    await page.request.put(
      `/api/portfolios/${portfolio.id}/planning/periods/${period.periodId}/scenarios/0`,
      { data: { revision, initiativeIds: [candidateA.id] } },
    ),
    200,
  );
  revision = scenarioA.revision;
  const scenarioB = await expectJson<{ revision: number }>(
    await page.request.put(
      `/api/portfolios/${portfolio.id}/planning/periods/${period.periodId}/scenarios/1`,
      { data: { revision, initiativeIds: [candidateB.id] } },
    ),
    200,
  );
  revision = scenarioB.revision;

  if (options.approval) {
    await expectJson(
      await page.request.put(
        `/api/portfolios/${portfolio.id}/planning/approval-settings`,
        {
          data: {
            enabled: true,
            finalApproverUserId: approverId,
            reviewerUserId: reviewerId,
          },
        },
      ),
      200,
    );
  }

  return { portfolioId: portfolio.id, periodId: period.periodId, revision, roleId, projectId };
}

async function submitProposal(
  page: Page,
  plan: Plan,
): Promise<{ id: number; version: number; status: string }> {
  const reviewer = (await loadDirectory(page)).find(
    (member) => member.email === REVIEWER.email,
  );
  if (!reviewer) throw new Error("proposal reviewer is missing");
  return expectJson(
    await page.request.post(`/api/portfolios/${plan.portfolioId}/planning/proposals`, {
      data: {
        periodId: plan.periodId,
        revision: plan.revision,
        chosenSlot: 1,
        reason: REASON,
        reviewerUserId: reviewer.id,
        requestId: crypto.randomUUID(),
      },
    }),
    201,
  );
}

async function reviewProposal(
  page: Page,
  plan: Plan,
  proposalId: number,
  action: "pass" | "return",
  note: string,
): Promise<void> {
  await expectJson(
    await page.request.post(
      `/api/portfolios/${plan.portfolioId}/planning/proposals/${proposalId}/review`,
      {
        data: {
          action,
          note,
          expectedStatus: "under_review",
          requestId: crypto.randomUUID(),
        },
      },
    ),
    200,
  );
}

function scenarioCard(page: Page, name: "A案" | "B案"): Locator {
  return page.getByRole("article").filter({
    has: page.getByRole("heading", { name, exact: true }),
  });
}

function supplyRow(page: Page, month: string): Locator {
  return page
    .getByRole("region", { name: "月別・職種別の需給比較" })
    .getByRole("row")
    .filter({ hasText: "DB担当" })
    .filter({ hasText: month });
}

async function openCompare(page: Page, plan: Plan): Promise<void> {
  await page.goto(
    `/portfolio/${plan.portfolioId}/planning?view=compare&period=2027-Q1`,
    { waitUntil: "networkidle" },
  );
  await expect(
    page.getByRole("heading", { name: "投資シナリオ比較", exact: true }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await login(page, ADMIN);
});

test("compare uses two columns at 1440 and stacks the decision panel above the cards below xl", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const directory = await loadDirectory(page);
  const reviewer = directory.find((member) => member.email === REVIEWER.email);
  const approver = directory.find((member) => member.email === APPROVER.email);
  if (!reviewer || !approver) throw new Error("layout fixture users are missing");
  const plan = await createPlan(page, {
    approval: true,
    viewers: [reviewer, approver],
  });
  await submitProposal(page, plan);
  await login(page, REVIEWER);
  await openCompare(page, plan);

  const overview = page.locator('section[aria-label="比較の概要"]');
  await expect(overview).toBeVisible();
  const budget = overview.locator("dl > div").filter({ hasText: "予算上限" });
  const fixed = overview.locator("dl > div").filter({ hasText: "固定案件" });
  const candidates = overview.locator("dl > div").filter({ hasText: "比較候補" });
  await expect(budget.locator("dd")).toHaveText(/1,000\s*万円/);
  await expect(fixed.locator("dd")).toHaveText(/600\s*万円/);
  await expect(candidates.locator("dd")).toHaveText(/2\s*件/);
  await expect(page.getByRole("button", { name: "予算上限を編集", exact: true })).toBeVisible();

  const panel = page.locator('aside[aria-label="決裁"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByText("あなたのレビュー待ち", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "B案の採用申請", exact: true }),
  ).toBeVisible();
  const flow = panel.getByRole("list", { name: "承認の流れ" });
  await expect(flow.getByRole("listitem")).toHaveCount(3);
  await expect(flow).toContainText("申請");
  await expect(flow).toContainText("レビュー");
  await expect(flow).toContainText("決裁");
  await expect(flow).toContainText("完了");
  await expect(flow).toContainText("現在");
  await expect(flow).toContainText("未到達");
  await expect(
    panel.getByRole("form", { name: "投資提案のレビュー" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "確認して決裁へ", exact: true }),
  ).toBeVisible();
  await expect(panel).toContainText(REASON);
  await expect(panel).toContainText(
    "提出時点の両案を固定して記録します。採用後に計画を変更しても、この記録は変わりません。",
  );

  const aCard = scenarioCard(page, "A案");
  const bCard = scenarioCard(page, "B案");
  await expect(aCard).toBeVisible();
  await expect(bCard).toBeVisible();
  await expect(aCard).toContainText("要調整");
  await expect(aCard).toContainText("1月 DB担当 4人日");
  await expect(aCard).toContainText(/1,000\s*万円/);
  await expect(aCard).toContainText("予算残 0 万円");
  await expect(bCard).toContainText("制約内");
  await expect(bCard).toContainText("人員の不足なし");
  await expect(bCard).toContainText("申請者の推奨");
  await expect(bCard).toContainText("予算残 100 万円");

  const januaryA = supplyRow(page, "1月").getByRole("cell").nth(1);
  const januaryB = supplyRow(page, "1月").getByRole("cell").nth(2);
  await expect(januaryA).toContainText("22 / 18");
  await expect(januaryA).toContainText("不足 4");
  await expect(januaryB).toContainText("18 / 18");
  await expect(januaryB).toContainText("残り 0");

  const panelAt1440 = (await panel.boundingBox())!;
  const cardAt1440 = (await bCard.boundingBox())!;
  expect(panelAt1440.x).toBeGreaterThan(cardAt1440.x + cardAt1440.width - 1);
  expect(panelAt1440.width).toBeGreaterThanOrEqual(340);
  expect(panelAt1440.width).toBeLessThanOrEqual(380);

  // Just above and below the xl boundary (80rem = 1280px).
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect(panel).toBeVisible();
  const panelAt1280 = (await panel.boundingBox())!;
  const cardAt1280 = (await aCard.boundingBox())!;
  expect(panelAt1280.x).toBeGreaterThan(cardAt1280.x + cardAt1280.width - 1);

  await page.setViewportSize({ width: 1279, height: 1000 });
  await expect(panel).toBeVisible();
  const panelAt1279 = (await panel.boundingBox())!;
  const cardAt1279 = (await aCard.boundingBox())!;
  expect(panelAt1279.y).toBeLessThan(cardAt1279.y);

  // 375px keeps the panel and cards readable without a horizontal page scroll.
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(panel).toBeVisible();
  const panelAt375 = (await panel.boundingBox())!;
  const cardAt375 = (await aCard.boundingBox())!;
  expect(panelAt375.y).toBeLessThan(cardAt375.y);
  expect(panelAt375.width).toBeLessThanOrEqual(375);
  expect(cardAt375.width).toBeGreaterThan(200);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test("the decision panel appears only for an open proposal and keeps the approval strip otherwise", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const directory = await loadDirectory(page);
  const reviewer = directory.find((member) => member.email === REVIEWER.email);
  const approver = directory.find((member) => member.email === APPROVER.email);
  if (!reviewer || !approver) throw new Error("layout fixture users are missing");

  const enabled = await createPlan(page, {
    approval: true,
    viewers: [reviewer, approver],
  });
  await openCompare(page, enabled);
  await expect(page.locator('aside[aria-label="決裁"]')).toHaveCount(0);
  const strip = page.getByRole("region", { name: "投資提案の承認" });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("承認フロー有効");
  await expect(strip).toContainText("最終承認者");
  await expect(strip).toContainText("レビュー担当");
  await expect(page.getByRole("button", { name: "A案で提案…", exact: true })).toBeEnabled();

  const disabled = await createPlan(page, { approval: false });
  await openCompare(page, disabled);
  await expect(page.locator('aside[aria-label="決裁"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "投資提案の承認" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "A案を採用…", exact: true })).toBeEnabled();

  const proposal = await submitProposal(page, enabled);
  await login(page, REVIEWER);
  await openCompare(page, enabled);
  const panel = page.locator('aside[aria-label="決裁"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByText("あなたのレビュー待ち", { exact: true })).toBeVisible();
  await expect(panel.getByRole("form", { name: "投資提案のレビュー" })).toBeVisible();
  await reviewProposal(
    page,
    enabled,
    proposal.id,
    "pass",
    "全月で配賦枠内に収まることを確認しました。",
  );

  await login(page, APPROVER);
  await openCompare(page, enabled);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("あなたの決裁待ち", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "B案の採用申請", exact: true }),
  ).toBeVisible();
  const flow = panel.getByRole("list", { name: "承認の流れ" });
  await expect(flow.getByRole("listitem")).toHaveCount(3);
  await expect(flow).toContainText("完了");
  await expect(flow).toContainText("現在");
  await expect(flow).toContainText("あなた");
  await expect(flow).not.toContainText("未到達");
  const decisionForm = panel.getByRole("form", {
    name: "投資提案の最終決裁",
  });
  await expect(decisionForm).toBeVisible();
  await expect(decisionForm.getByLabel("決定理由")).toBeVisible();
  await expect(
    decisionForm.getByRole("button", { name: /^承認して(?: .+を)?採用$/ }),
  ).toBeVisible();
  await expect(
    decisionForm.getByRole("button", { name: "差し戻す", exact: true }),
  ).toBeVisible();
  await expect(
    decisionForm.getByRole("button", { name: "今期は見送る", exact: true }),
  ).toBeVisible();
});

test("restricted plans never show totals, demand or adoption actions", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const directory = await loadDirectory(page);
  const reviewer = directory.find((member) => member.email === REVIEWER.email);
  if (!reviewer) throw new Error("restricted fixture viewer is missing");
  const plan = await createPlan(page, {
    approval: false,
    viewers: [reviewer],
    linkedProject: true,
  });
  await login(page, REVIEWER);
  await openCompare(page, plan);

  await expect(page.getByText("閲覧制限", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(
      "閲覧できない案件が含まれるため、合計・不足・見送る効果・採用操作は表示できません。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('section[aria-label="比較の概要"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A案", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "B案", exact: true })).toHaveCount(0);
  await expect(page.getByText("予算上限", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /を採用/ })).toHaveCount(0);
  await expect(page.locator('aside[aria-label="決裁"]')).toHaveCount(0);
});
