import { expect, test, type APIResponse, type Page } from "@playwright/test";

test.use({ actionTimeout: 15_000 });

/**
 * Focused approval regression for the shared-portfolio investment plan.
 *
 * The plan is seeded through the product's own HTTP APIs because the test is
 * about the review -> final-decision hand-off, not plan entry. Every review and
 * decision action then goes through the normal portfolio entry and comparison
 * UI as the assigned people. Admin/owner access is checked as a negative case.
 */

const ADMIN = { email: "admin@example.com", password: "atlas-dev-2026" };
const REVIEWER = { email: "sato@example.com", password: "atlas-dev-2026" };
const APPROVER = { email: "tanaka@example.com", password: "atlas-dev-2026" };
const PROPOSAL_REASON =
  "基盤更改と顧客分析で今期の効果を最大化し、1月の配賦枠内に収めるため。";
const REVIEW_NOTE =
  "1月の需要と配賦枠を確認しました。顧客分析の見送り効果も妥当です。";
const DECISION_REASON =
  "レビュー結果を確認し、B案を採用します。次期に申請自動化を再検討します。";

type DirectoryMember = {
  id: number;
  name: string;
  email: string | null;
};

type PlanningStateForTest = {
  selectedPeriod: { id: number; revision: number; budgetYen: number } | null;
  roles: { id: number; name: string }[];
  proposals: {
    id: number;
    version: number;
    status: string;
    decisionAction: string | null;
    decisionId: number | null;
    snapshot: unknown;
  }[];
  decisions: {
    id: number;
    chosenSlot: 0 | 1;
    chosenScenarioName: string;
    sourceProposalId: number | null;
    reason: string;
    actorName: string;
    snapshot: {
      period: { revision: number; budgetYen: number };
      scenarios: {
        slot: 0 | 1;
        cells: {
          roleId: number;
          monthIndex: number;
          capacityDays: number | null;
        }[];
      }[];
    };
  }[];
};

const seededPortfolios = new WeakMap<Page, number>();

async function expectJson<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

async function login(page: Page, user: { email: string; password: string }): Promise<void> {
  const response = await page.request.post("/api/auth/login", { data: user });
  expect(response.status(), await response.text()).toBe(200);
}

async function loadPlanningState(
  page: Page,
  portfolioId: number,
): Promise<PlanningStateForTest> {
  return expectJson<PlanningStateForTest>(
    await page.request.get(`/api/portfolios/${portfolioId}/planning`),
    200,
  );
}

async function loadDirectory(page: Page): Promise<DirectoryMember[]> {
  const response = await page.request.get("/api/users");
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { users: DirectoryMember[] };
  return body.users;
}

function waitForApi(page: Page, method: string, pathSuffix: string) {
  return page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === method && pathname.endsWith(pathSuffix);
  });
}

async function runWithApiWait(
  page: Page,
  method: string,
  pathSuffix: string,
  action: () => Promise<void>,
) {
  const [response] = await Promise.all([waitForApi(page, method, pathSuffix), action()]);
  return response;
}

async function openPlanningFromPortfolio(
  page: Page,
  portfolio: { name: string },
): Promise<void> {
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "共有ポートフォリオ", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: new RegExp(portfolio.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
    .click();
  await expect(page.getByRole("heading", { name: portfolio.name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: /投資計画を開く/ }).click();
  await expect(page).toHaveURL(/\/portfolio\/\d+\/planning\?view=ledger/);
  await page
    .getByRole("navigation", { name: "投資計画" })
    .getByRole("button", { name: "投資シナリオ比較", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "投資計画" })
      .getByRole("button", { name: "投資シナリオ比較", exact: true }),
  ).toHaveAttribute("aria-current", "page");
}

async function seedApprovalFixture(page: Page): Promise<{
  id: number;
  name: string;
  reviewer: DirectoryMember;
  approver: DirectoryMember;
}> {
  const directory = await loadDirectory(page);
  const reviewer = directory.find((member) => member.email === REVIEWER.email);
  const approver = directory.find((member) => member.email === APPROVER.email);
  const admin = directory.find((member) => member.email === ADMIN.email);
  if (!reviewer || !approver || !admin) throw new Error("approval fixture users are missing");

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `投資承認E2E ${suffix}`;
  const portfolio = await expectJson<{ id: number }>(
    await page.request.post("/api/portfolios", {
      data: {
        name,
        description: "投資提案のレビューと最終決裁を確認するE2E用ポートフォリオ",
      },
    }),
    201,
  );
  seededPortfolios.set(page, portfolio.id);

  for (const member of [reviewer, approver]) {
    await expectJson(
      await page.request.post(`/api/portfolios/${portfolio.id}/planning/viewers`, {
        data: { userId: member.id },
      }),
      200,
    );
  }

  const period = await expectJson<{ periodId: number; revision: number }>(
    await page.request.post(`/api/portfolios/${portfolio.id}/planning/periods`, {
      data: { year: 2028, quarter: 1, budgetYen: 1_000_000, roles: ["エンジニア"] },
    }),
    201,
  );
  const firstState = await loadPlanningState(page, portfolio.id);
  const roleId = firstState.roles[0]?.id;
  if (!roleId) throw new Error("planning role was not created");

  const fixed = await expectJson<{ id: number; revision: number }>(
    await page.request.post(`/api/portfolios/${portfolio.id}/planning/initiatives`, {
      data: {
        periodId: period.periodId,
        revision: period.revision,
        name: "基盤更改",
        ownerMemberId: admin.id,
        expectedEffect: "保守期限までに基盤を移行",
        kind: "fixed",
        linkedProjectId: null,
        costYen: 300_000,
        demands: [1, 2, 3].map((monthIndex) => ({ roleId, monthIndex, days: 10 })),
      },
    }),
    201,
  );
  const candidate = await expectJson<{ id: number; revision: number }>(
    await page.request.post(`/api/portfolios/${portfolio.id}/planning/initiatives`, {
      data: {
        periodId: period.periodId,
        revision: fixed.revision,
        name: "顧客分析",
        ownerMemberId: admin.id,
        expectedEffect: "顧客レポートの集計を月20時間削減",
        kind: "candidate",
        linkedProjectId: null,
        costYen: 200_000,
        demands: [1, 2, 3].map((monthIndex) => ({ roleId, monthIndex, days: 5 })),
      },
    }),
    201,
  );

  const capacity = await expectJson<{ revision: number }>(
    await page.request.put(
      `/api/portfolios/${portfolio.id}/planning/periods/${period.periodId}/capacity`,
      {
        data: {
          revision: candidate.revision,
          capacities: [1, 2, 3].map((monthIndex) => ({ roleId, monthIndex, days: 20 })),
        },
      },
    ),
    200,
  );
  const scenarioA = await expectJson<{ revision: number }>(
    await page.request.put(
      `/api/portfolios/${portfolio.id}/planning/periods/${period.periodId}/scenarios/0`,
      { data: { revision: capacity.revision, initiativeIds: [] } },
    ),
    200,
  );
  const scenarioB = await expectJson<{ revision: number }>(
    await page.request.put(
      `/api/portfolios/${portfolio.id}/planning/periods/${period.periodId}/scenarios/1`,
      { data: { revision: scenarioA.revision, initiativeIds: [candidate.id] } },
    ),
    200,
  );

  await expectJson(
    await page.request.put(`/api/portfolios/${portfolio.id}/planning/approval-settings`, {
      data: {
        enabled: true,
        finalApproverUserId: approver.id,
        reviewerUserId: reviewer.id,
      },
    }),
    200,
  );
  await expectJson(
    await page.request.post(`/api/portfolios/${portfolio.id}/planning/proposals`, {
      data: {
        periodId: period.periodId,
        revision: scenarioB.revision,
        chosenSlot: 1,
        reason: PROPOSAL_REASON,
        reviewerUserId: reviewer.id,
        requestId: crypto.randomUUID(),
      },
    }),
    201,
  );

  return { id: portfolio.id, name, reviewer, approver };
}

async function decisionAttempt(
  page: Page,
  portfolioId: number,
  proposalId: number,
  reason: string,
): Promise<APIResponse> {
  return page.request.post(
    `/api/portfolios/${portfolioId}/planning/proposals/${proposalId}/decision`,
    {
      data: {
        action: "approve",
        reason,
        requestId: crypto.randomUUID(),
      },
    },
  );
}

test.beforeEach(async ({ page }) => {
  await login(page, ADMIN);
});

test.afterEach(async ({ page }, info) => {
  info.setTimeout(20_000);
  const portfolioId = seededPortfolios.get(page);
  if (portfolioId === undefined) return;
  try {
    // The test ends as an approver/viewer; restore an editor for cleanup.
    await login(page, ADMIN);
    const response = await page.request.delete(`/api/portfolios/${portfolioId}`, {
      timeout: 10_000,
    });
    expect(response.status()).toBe(200);
  } catch (error) {
    if (info.status === info.expectedStatus) throw error;
    info.annotations.push({
      type: "cleanup",
      description: `Portfolio cleanup after the original failure: ${String(error)}`,
    });
  }
});

test("assigned reviewer passes and assigned approver adopts the frozen B snapshot", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await seedApprovalFixture(page);
  const submitted = await loadPlanningState(page, fixture.id);
  const proposal = submitted.proposals[0];
  if (!proposal) throw new Error("proposal was not submitted");
  expect(proposal.status).toBe("under_review");

  // The portfolio owner is also a workspace admin, but not the assigned
  // approver. Plan-edit rights must not substitute for the frozen assignment.
  const ownerAttempt = await decisionAttempt(page, fixture.id, proposal.id, DECISION_REASON);
  expect(ownerAttempt.status(), await ownerAttempt.text()).toBe(403);

  // The assigned approver also cannot skip the pending assigned review.
  await login(page, APPROVER);
  const skipAttempt = await decisionAttempt(page, fixture.id, proposal.id, DECISION_REASON);
  expect(skipAttempt.status(), await skipAttempt.text()).toBe(409);
  expect((await skipAttempt.json()) as { code: string }).toMatchObject({ code: "review_pending" });

  // Assigned reviewer, through the normal portfolio entry point.
  await login(page, REVIEWER);
  await openPlanningFromPortfolio(page, fixture);
  const reviewButton = page
    .locator("#proposal-history")
    .getByRole("button", { name: "レビューする", exact: true });
  await expect(reviewButton).toBeVisible();
  await reviewButton.click();
  const dialog = page.getByRole("dialog", { name: "投資提案（版1）", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("最終承認待ち")).toHaveCount(0);

  // Empty comment: exactly one alert, and the field keeps an accessible
  // description. This is the nested role=alert regression.
  await dialog.getByRole("button", { name: "確認して決裁へ", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(1);
  await expect(dialog.getByRole("alert")).toContainText("コメント");
  const reviewField = dialog.getByLabel("レビューのコメント・差し戻し理由");
  await expect(reviewField).toHaveAttribute("aria-invalid", "true");
  const describedBy = await reviewField.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(dialog.locator(`#${describedBy}`)).toHaveText(/コメント/);

  await reviewField.fill(REVIEW_NOTE);
  const reviewResponse = await runWithApiWait(page, "POST", "/review", () =>
    dialog.getByRole("button", { name: "確認して決裁へ", exact: true }).click(),
  );
  expect(reviewResponse.status(), await reviewResponse.text()).toBe(200);
  await expect(dialog.getByText("最終承認待ち").first()).toBeVisible();
  await expect(dialog.getByText(REVIEW_NOTE, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const afterReview = await loadPlanningState(page, fixture.id);
  expect(afterReview.proposals[0]?.status).toBe("pending_decision");

  // Assigned approver, again through the normal entry point.
  await login(page, APPROVER);
  await page.reload();
  await openPlanningFromPortfolio(page, fixture);
  const decideButton = page
    .locator("#proposal-history")
    .getByRole("button", { name: "決裁する", exact: true });
  await expect(decideButton).toBeVisible();
  await decideButton.click();
  const decisionDialog = page.getByRole("dialog", { name: "投資提案（版1）", exact: true });
  await expect(decisionDialog).toBeVisible();
  await expect(decisionDialog.getByRole("button", { name: "承認して採用", exact: true })).toBeVisible();
  await expect(decisionDialog.getByRole("button", { name: "差し戻す", exact: true })).toBeVisible();
  await expect(decisionDialog.getByRole("button", { name: "今期は見送る", exact: true })).toBeVisible();

  // A decision always needs its own recorded reason.
  await decisionDialog.getByRole("button", { name: "承認して採用", exact: true }).click();
  await expect(decisionDialog.getByRole("alert")).toHaveCount(1);
  await expect(decisionDialog.getByRole("alert")).toContainText("決定理由");
  const decisionField = decisionDialog.getByLabel("決定理由");
  await expect(decisionField).toHaveAttribute("aria-invalid", "true");

  await decisionField.fill(DECISION_REASON);
  const decisionResponse = await runWithApiWait(page, "POST", "/decision", () =>
    decisionDialog.getByRole("button", { name: "承認して採用", exact: true }).click(),
  );
  expect(decisionResponse.status(), await decisionResponse.text()).toBe(200);
  await expect(decisionDialog.getByText("承認済み").first()).toBeVisible();
  await expect(decisionDialog.getByText(DECISION_REASON, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(decisionDialog).toHaveCount(0);

  const history = page.locator("#decision-history");
  await expect(history.getByText("提案から採用", { exact: true })).toBeVisible();
  await expect(history).toContainText(PROPOSAL_REASON);
  await expect(history).toContainText(REVIEW_NOTE);
  await expect(history).toContainText(DECISION_REASON);
  await expect(history.getByRole("heading", { name: "B案を採用", exact: true })).toBeVisible();

  // Persisted state: one approved proposal, one linked immutable decision and
  // an identical submitted snapshot on both records.
  const approved = await loadPlanningState(page, fixture.id);
  const approvedProposal = approved.proposals[0];
  expect(approvedProposal?.status).toBe("approved");
  expect(approvedProposal?.decisionAction).toBe("approve");
  expect(approvedProposal?.decisionId).not.toBeNull();
  expect(approved.decisions).toHaveLength(1);
  const adopted = approved.decisions[0];
  expect(adopted.sourceProposalId).toBe(approvedProposal?.id);
  expect(adopted.chosenSlot).toBe(1);
  expect(adopted.chosenScenarioName).toBe("B案");
  expect(adopted.reason).toBe(DECISION_REASON);
  expect(adopted.actorName).toBe(fixture.approver.name);
  expect(adopted.snapshot).toEqual(approvedProposal?.snapshot);

  // Repeating the action cannot create a contradictory second decision.
  const duplicate = await decisionAttempt(page, fixture.id, proposal.id, DECISION_REASON);
  expect(duplicate.status(), await duplicate.text()).toBe(409);
  const afterDuplicate = await loadPlanningState(page, fixture.id);
  expect(afterDuplicate.decisions).toHaveLength(1);

  // Editing the live plan after approval must not rewrite the frozen history.
  await login(page, ADMIN);
  const beforeEdit = await loadPlanningState(page, fixture.id);
  const period = beforeEdit.selectedPeriod;
  const roleId = beforeEdit.roles[0]?.id;
  if (!period || !roleId) throw new Error("planning period or role disappeared");
  const capacityResponse = await page.request.put(
    `/api/portfolios/${fixture.id}/planning/periods/${period.id}/capacity`,
    {
      data: {
        revision: period.revision,
        capacities: [1, 2, 3].map((monthIndex) => ({
          roleId,
          monthIndex,
          days: monthIndex === 1 ? 12 : 20,
        })),
      },
    },
  );
  expect(capacityResponse.status(), await capacityResponse.text()).toBe(200);

  const preserved = await loadPlanningState(page, fixture.id);
  expect(preserved.selectedPeriod?.revision).toBeGreaterThan(period.revision);
  const preservedDecision = preserved.decisions[0];
  const january = preservedDecision?.snapshot.scenarios[1].cells.find(
    (cell) => cell.roleId === roleId && cell.monthIndex === 1,
  );
  expect(january?.capacityDays).toBe(20);
  expect(preservedDecision?.snapshot).toEqual(approvedProposal?.snapshot);
});
