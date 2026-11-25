import { execFileSync } from "node:child_process";
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

async function seedApprovalFixture(page: Page, linkedProjectId: number | null = null): Promise<{
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


  if (linkedProjectId !== null) {
    await expectJson(await page.request.post(`/api/portfolios/${portfolio.id}/projects`, {
      data: { project_id: linkedProjectId },
    }), 201);
  }
  for (const member of [reviewer, approver]) {
    if (linkedProjectId !== null) {
      await expectJson(await page.request.post(`/api/projects/${linkedProjectId}/members`, {
        data: { user_id: member.id, role: "viewer" },
      }), 201);
    }
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
        linkedProjectId,
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
  await openPlanningFromPortfolio(page, { name });
  await page.getByRole("button", { name: "B案で提案…" }).click();
  const fixedReviewer = page.getByRole("dialog").locator("select[name=reviewerUserId]");
  await expect(fixedReviewer).toBeDisabled();
  await expect(fixedReviewer).toHaveValue(String(reviewer.id));
  await page.keyboard.press("Escape");
  for (const reviewerUserId of [null, admin.id, approver.id]) {
    const bypass = await page.request.post(`/api/portfolios/${portfolio.id}/planning/proposals`, {
      data: { periodId: period.periodId, revision: scenarioB.revision, chosenSlot: 1, reason: PROPOSAL_REASON,
        reviewerUserId, requestId: crypto.randomUUID() },
    });
    expect(bypass.status()).toBe(409);
  }
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

function planningFixtureSql(statement: string, proposalId: number): string {
  return execFileSync("bash", [
    "-euc",
    'source scripts/e2e-guard.sh; require_e2e_target </dev/null; db_sql -qAt -v proposal_id="$1"',
    "planning-review-test",
    String(proposalId),
  ], { input: statement, encoding: "utf8" }).trim();
}

test("review replays recheck source visibility and record exactly one audit entry", async ({ page }) => {
  const project = await expectJson<{ id: number }>(await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: "レビュー元 " + crypto.randomUUID() },
  }), 201);
  const fixture = await seedApprovalFixture(page, project.id);
  const [proposal] = (await loadPlanningState(page, fixture.id)).proposals;
  const url = `/api/portfolios/${fixture.id}/planning/proposals/${proposal.id}/review`;
  const data = { action: "pass", note: REVIEW_NOTE, requestId: crypto.randomUUID(), expectedStatus: "under_review" };
  await login(page, REVIEWER);
  const first = await expectJson<Record<string, unknown>>(await page.request.post(url, { data }), 200);
  expect(first).toEqual({
    id: proposal.id, version: proposal.version, status: "pending_decision",
    outcome: "passed", reviewedAt: expect.any(String), idempotent: false,
  });
  const replay = await expectJson(await page.request.post(url, { data }), 200);
  expect(replay).toEqual({ ...first, idempotent: true });
  const reused = await expectJson(await page.request.post(url, { data: { ...data, note: REVIEW_NOTE + "再確認" } }), 409);
  expect(reused).toMatchObject({ code: "request_id_reused" });
  const stale = await expectJson(await page.request.post(url, { data: { ...data, requestId: crypto.randomUUID() } }), 409);
  expect(stale).toMatchObject({ code: "proposal_status_changed" });

  await login(page, ADMIN);
  await expectJson(await page.request.delete(`/api/projects/${project.id}/members/${fixture.reviewer.id}`), 200);
  await login(page, REVIEWER);
  const denied = await expectJson(await page.request.post(url, { data }), 403);
  expect(denied).toMatchObject({ error: expect.stringContaining("閲覧権限のない元プロジェクト") });
  expect(planningFixtureSql(`
    SELECT actor_id, summary FROM audit_log
    WHERE action = 'portfolio_plan.proposal_review' AND entity = 'portfolio_plan_proposal'
      AND entity_id = :proposal_id;
  `, proposal.id)).toBe(`${fixture.reviewer.id}|ポートフォリオ #${fixture.id} / v${proposal.version} / passed`);
});

test("review of a legacy submitted proposal rolls back when its audit insert fails", async ({ page }) => {
  const fixture = await seedApprovalFixture(page);
  const [proposal] = (await loadPlanningState(page, fixture.id)).proposals;
  const url = `/api/portfolios/${fixture.id}/planning/proposals/${proposal.id}/review`;
  const data = { action: "pass", note: REVIEW_NOTE, requestId: crypto.randomUUID(), expectedStatus: "submitted" };
  await login(page, REVIEWER);
  // Only this proposal's review audit is rejected in the disposable database.
  planningFixtureSql(`
    UPDATE portfolio_plan_proposals SET status = 'submitted' WHERE id = :proposal_id;
    ALTER TABLE audit_log ADD CONSTRAINT reject_review_:proposal_id
      CHECK (action <> 'portfolio_plan.proposal_review' OR entity_id <> :proposal_id) NOT VALID;
  `, proposal.id);
  try {
    const failed = await page.request.post(url, { data });
    expect(failed.status(), await failed.text()).toBe(500);
    expect(planningFixtureSql(`
      SELECT status, reviewed_at IS NULL, review_request_id IS NULL FROM portfolio_plan_proposals
      WHERE id = :proposal_id;
    `, proposal.id)).toBe("submitted|t|t");
  } finally {
    planningFixtureSql("ALTER TABLE audit_log DROP CONSTRAINT reject_review_:proposal_id;", proposal.id);
  }
  const retry = await expectJson(await page.request.post(url, { data }), 200);
  expect(retry).toMatchObject({ id: proposal.id, status: "pending_decision", outcome: "passed", idempotent: false });
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
  await expect(decisionDialog.getByRole("button", { name: /^承認して(?: .+を)?採用$/ })).toBeVisible();
  await expect(decisionDialog.getByRole("button", { name: "差し戻す", exact: true })).toBeVisible();
  await expect(decisionDialog.getByRole("button", { name: "今期は見送る", exact: true })).toBeVisible();

  // A decision always needs its own recorded reason.
  await decisionDialog.getByRole("button", { name: /^承認して(?: .+を)?採用$/ }).click();
  await expect(decisionDialog.getByRole("alert")).toHaveCount(1);
  await expect(decisionDialog.getByRole("alert")).toContainText("決定理由");
  const decisionField = decisionDialog.getByLabel("決定理由");
  await expect(decisionField).toHaveAttribute("aria-invalid", "true");

  await decisionField.fill(DECISION_REASON);
  const decisionResponse = await runWithApiWait(page, "POST", "/decision", () =>
    decisionDialog.getByRole("button", { name: /^承認して(?: .+を)?採用$/ }).click(),
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

  const directDelete = await page.request.delete("/api/portfolios/" + fixture.id);
  expect(directDelete.status()).toBe(409);
  await page.goto("/portfolio");
  await page.getByRole("button", { name: new RegExp(fixture.name) }).click();
  await page.getByRole("button", { name: "ポートフォリオを削除" }).click();
  const prompt = page.getByRole("dialog", { name: "確認" });
  await expect(prompt).toContainText("申請・採用履歴");
  const blocked = await runWithApiWait(page, "DELETE", "/portfolios/" + fixture.id,
    () => prompt.getByRole("button", { name: "OK" }).click());
  expect(blocked.status()).toBe(409);
  await expect(page.getByRole("status").filter({ hasText: "申請・採用履歴があるため削除できません" })).toBeVisible();
  await openPlanningFromPortfolio(page, fixture);
  await expect(page.locator("#decision-history")).toContainText(DECISION_REASON);
  await expect(page.locator("#proposal-history")).toContainText("承認済み");
  const retained = await loadPlanningState(page, fixture.id);
  expect(retained.decisions).toEqual(preserved.decisions);
  expect(retained.proposals).toEqual(preserved.proposals);

  await page.goto("/audit");
  for (const action of ["proposal_submit", "proposal_review", "proposal_decide", "adopt"]) {
    const entry = page.locator("[data-audit-row]").filter({ has: page.getByText("portfolio_plan." + action, { exact: true }) })
      .filter({ hasText: "ポートフォリオ #" + fixture.id + " / " });
    await expect(entry).toHaveCount(1);
  }
});

test("owner cannot bypass approval after withdrawal and changes remain auditable", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = await loadDirectory(page);
  const userId = (email: string) => directory.find(person => person.email === email)!.id;
  const owner = userId(REVIEWER.email);
  const final = userId(APPROVER.email);
  const reviewer = userId(ADMIN.email);
  await login(page, REVIEWER);
  const name = "設定統制 " + crypto.randomUUID();
  const { id } = await expectJson<{ id: number }>(await page.request.post("/api/portfolios", { data: { name } }), 201);
  const root = "/api/portfolios/" + id + "/planning";
  const settings = root + "/approval-settings";
  await expectJson(await page.request.post(root + "/viewers", { data: { userId: final } }), 200);
  const period = await expectJson<{ periodId: number; revision: number }>(await page.request.post(root + "/periods", {
    data: { year: 2028, quarter: 2, budgetYen: 250000, roles: ["企画"] },
  }), 201);

  await expectJson(await page.request.put(settings, {
    data: { enabled: true, finalApproverUserId: final, reviewerUserId: final },
  }), 409);
  await openPlanningFromPortfolio(page, { name });
  await page.getByRole("button", { name: "承認設定", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "投資提案の承認設定" });
  await dialog.locator("[name=approvalsEnabled]").check();
  await dialog.locator("[name=finalApproverUserId]").selectOption(String(final));
  await expect(dialog.locator('[name=reviewerUserId] option[value="' + final + '"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "承認設定を保存" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "A案で提案…" }).click();
  dialog = page.getByRole("dialog");
  const picker = dialog.locator("select[name=reviewerUserId]");
  await expect(picker).toBeEnabled();
  for (const excluded of [owner, final]) {
    await expect(picker.locator('option[value="' + excluded + '"]')).toHaveCount(0);
  }
  await expect(picker.locator('option[value="' + reviewer + '"]')).toHaveCount(1);
  await page.keyboard.press("Escape");

  const payload = { periodId: period.periodId, revision: period.revision, chosenSlot: 0, reason: "検証用の投資提案" };
  const submit = (reviewerUserId: number) => page.request.post(root + "/proposals", {
    data: { ...payload, reviewerUserId, requestId: crypto.randomUUID() },
  });
  for (const bad of [owner, final]) await expectJson(await submit(bad), 409);
  const proposal = await expectJson<{ id: number }>(await submit(reviewer), 201);
  const proposalsUrl = root + "/proposals/" + proposal.id;
  await expectJson(await page.request.post(proposalsUrl + "/review", { data: { action: "pass", note: "自己確認" } }), 403);
  await expectJson(await page.request.put(settings, { data: { enabled: false, requestChange: true } }), 409);
  await page.reload();
  await expect(page.locator("#proposal-history").getByRole("button", { name: "レビューする" })).toHaveCount(0);
  await expectJson(await page.request.post(proposalsUrl + "/withdraw", {
    data: { reason: "再検討のため取下げ", requestId: crypto.randomUUID() },
  }), 200);
  await expectJson(await page.request.delete("/api/portfolios/" + id), 409);
  const direct = () => page.request.post(root + "/periods/" + period.periodId + "/decisions", {
    data: { ...payload, requestId: crypto.randomUUID() },
  });
  await expectJson(await page.request.put(settings, { data: { enabled: false } }), 409);
  await expectJson(await page.request.put(settings, { data: { enabled: true, finalApproverUserId: owner } }), 409);
  await expectJson(await direct(), 409);
  await page.reload();
  await page.getByRole("button", { name: "承認設定", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "投資提案の承認設定" });
  await dialog.locator("[name=approvalsEnabled]").uncheck();
  const request = await runWithApiWait(page, "PUT", "/approval-settings", () =>
    dialog.getByRole("button", { name: "設定変更を申請" }).click());
  expect(request.status()).toBe(202);
  const { pendingId } = await request.json() as { pendingId: number };
  const panel = page.getByRole("region", { name: "承認設定の変更申請" });
  await expect(panel).toContainText("無効");
  await expect(panel.getByRole("button", { name: "設定変更を承認" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "A案を採用…" })).toHaveCount(0);
  const confirm = () => page.request.post(settings, { data: { action: "confirm", changeId: pendingId } });
  await expectJson(await confirm(), 403);
  const reopened = await expectJson<{ id: number }>(await submit(reviewer), 201);
  await login(page, APPROVER);
  await page.reload();
  await expect(panel.getByRole("button", { name: "設定変更を承認" })).toBeDisabled();
  await expectJson(await confirm(), 409);
  await login(page, REVIEWER);
  await expectJson(await page.request.post(root + "/proposals/" + reopened.id + "/withdraw", {
    data: { reason: "設定変更前に提案を取下げ", requestId: crypto.randomUUID() },
  }), 200);
  await login(page, ADMIN);
  await expectJson(await confirm(), 403);
  await expectJson(await direct(), 409);
  await login(page, APPROVER);
  await page.reload();
  await expect(panel).toContainText("無効");
  const confirmation = await runWithApiWait(page, "POST", "/approval-settings", () =>
    panel.getByRole("button", { name: "設定変更を承認" }).click());
  expect(confirmation.status()).toBe(200);
  await expect(panel).toHaveCount(0);
  await expectJson(await confirm(), 409);
  await expectJson(await page.request.get("/api/admin/audit/export"), 403);
  await login(page, REVIEWER);
  await page.reload();
  await expect(page.getByRole("button", { name: "A案を採用…" })).toBeEnabled();
  await expectJson(await direct(), 201);
  await expectJson(await page.request.patch(root + "/periods/" + period.periodId, {
    data: { revision: period.revision, budgetYen: 200000 },
  }), 200);
  await page.reload();
  await expect(page.locator("#decision-history")).toContainText("承認フロー外で採用");
  await page.getByText("承認設定の変更履歴（直近20件）", { exact: true }).click();
  const history = page.locator("details").filter({ has: page.getByText("承認設定の変更履歴（直近20件）", { exact: true }) });
  await expect(history).toContainText("有効（最終承認者 #" + final + "、レビュー担当 なし） → 無効");
  await expect(history).toContainText("申請者 #" + owner);
  await login(page, ADMIN);
  await page.goto("/audit");
  const auditRow = page.locator("[data-audit-row]").filter({ has: page.getByText("portfolio_plan.approval_settings_update", { exact: true }) })
    .filter({ hasText: "変更申請 #" + pendingId + "（申請者 #" + owner + "）" });
  await expect(auditRow).toContainText(directory.find(person => person.id === final)!.name);
  await expect(auditRow).toContainText("→ 無効");
  await expect(page.getByText("ポートフォリオ #" + id + " / 250000円 → 200000円", { exact: true })).toBeVisible();
  type Entry = { entity_id: string; entity: string; action: string; summary: string; actor_name: string };
  const json = await expectJson<{ rows: Entry[] }>(await page.request.get("/api/admin/audit/export?format=json"), 200);
  const entries = json.rows.filter(row => row.entity === "portfolio" && Number(row.entity_id) === id);
  expect(entries.filter(row => row.action === "portfolio_plan.approval_settings_update")).toHaveLength(2);
  expect(entries.filter(row => row.action === "portfolio_plan.approval_settings_request")).toHaveLength(1);
  const csv = await page.request.get("/api/admin/audit/export?format=csv");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("250000円 → 200000円");
  expect(await csv.text()).toContain("変更申請 #" + pendingId + "（申請者 #" + owner + "）");
  // Portfolios with no proposals or decisions still use ordinary deletion.
  const empty = await expectJson<{ id: number }>(await page.request.post("/api/portfolios", { data: { name: name + " 空" } }), 201);
  await expectJson(await page.request.delete("/api/portfolios/" + empty.id), 200);
});

test("lost assignees require an independently approved replacement", async ({ page }) => {
  const token = crypto.randomUUID();
  const users = await loadDirectory(page);
  const replacement = users.find(person => person.email === APPROVER.email)!;
  const temporary = async (name: string) => expectJson<{ id: number }>(await page.request.post("/api/admin/users", {
    data: { name, email: name + "-" + token + "@example.test", password: "Atlas-Test-" + token },
  }), 201);
  const reviewer = await temporary("reviewer");
  const approver = await temporary("approver");
  await login(page, REVIEWER);
  const name = "担当者交代 " + token;
  const { id } = await expectJson<{ id: number }>(await page.request.post("/api/portfolios", { data: { name } }), 201);
  const root = "/api/portfolios/" + id + "/planning";
  const settings = root + "/approval-settings";
  for (const member of [reviewer, approver, replacement]) {
    await expectJson(await page.request.post(root + "/viewers", { data: { userId: member.id } }), 200);
  }
  const period = await expectJson<{ periodId: number; revision: number }>(await page.request.post(root + "/periods", {
    data: { year: 2028, quarter: 1, budgetYen: 100000, roles: ["検証"] },
  }), 201);
  await expectJson(await page.request.put(settings, {
    data: { enabled: true, finalApproverUserId: approver.id, reviewerUserId: reviewer.id },
  }), 200);
  await login(page, ADMIN);
  await expectJson(await page.request.delete("/api/admin/users/" + reviewer.id), 200);
  await login(page, REVIEWER);
  await openPlanningFromPortfolio(page, { name });
  await expect(page.getByRole("button", { name: "A案で提案…" })).toBeDisabled();
  await expectJson(await page.request.post(root + "/proposals", {
    data: { ...period, chosenSlot: 0, reason: "削除された担当者を省略できない", requestId: crypto.randomUUID() },
  }), 409);
  await login(page, ADMIN);
  await expectJson(await page.request.delete("/api/admin/users/" + approver.id), 200);
  await login(page, REVIEWER);
  await expectJson(await page.request.put(settings, { data: { enabled: false, requestChange: true } }), 409);
  const change = () => page.request.put(settings, {
    data: { enabled: true, finalApproverUserId: replacement.id, reviewerUserId: null, requestChange: true },
  });
  const resolve = (changeId: number, action: string) => page.request.post(settings, { data: { changeId, action } });
  const first = await expectJson<{ pendingId: number }>(await change(), 202);
  await expectJson(await resolve(first.pendingId, "cancel"), 200);
  const second = await expectJson<{ pendingId: number }>(await change(), 202);
  expect(second.pendingId).not.toBe(first.pendingId);
  expect(await expectJson(await change(), 202)).toMatchObject({ pendingId: second.pendingId });
  await login(page, APPROVER);
  await expectJson(await resolve(second.pendingId, "confirm"), 403);
  await login(page, ADMIN);
  await expectJson(await resolve(first.pendingId, "confirm"), 409);
  await page.reload();
  const panel = page.getByRole("region", { name: "承認設定の変更申請" });
  await expect(panel).toContainText(replacement.name);
  await panel.getByRole("button", { name: "設定変更を承認" }).click();
  await expect(panel).toHaveCount(0);
  const state = await expectJson(await page.request.get(root), 200);
  expect(state).toMatchObject({ approval: { enabled: true, finalApprover: { id: replacement.id }, reviewer: null } });
});
