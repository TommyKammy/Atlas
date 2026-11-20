import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanningScenarioResult } from "./calculations";
import {
  approvalFlowStages,
  budgetUsagePercent,
  comparisonOverview,
  previousReturnedProposal,
  primaryCapacityGap,
  proposalAttentionLabel,
  proposalPanelTitle,
} from "./compare-summary";
import type {
  PlanningProposal,
  PlanningProposalComplete,
  PlanningProposalRestricted,
  PlanningScenarioSnapshot,
  PlanningSnapshotCell,
  PlanningSnapshotShortage,
} from "./types";

function cell(overrides: Partial<PlanningSnapshotCell>): PlanningSnapshotCell {
  return {
    roleId: 1,
    roleName: "DB担当",
    monthIndex: 1,
    demandDays: 10,
    demandMissing: false,
    capacityDays: 10,
    capacityMissing: false,
    gapDays: 0,
    shortageDays: 0,
    demandComplete: true,
    ...overrides,
  };
}

function shortage(
  overrides: Partial<PlanningSnapshotShortage>,
): PlanningSnapshotShortage {
  return {
    roleId: 1,
    roleName: "DB担当",
    monthIndex: 1,
    shortageDays: 4,
    demandMissing: false,
    ...overrides,
  };
}

function scenario(
  overrides: Partial<PlanningScenarioResult> = {},
): PlanningScenarioResult {
  return {
    slot: 0,
    name: "A案",
    included: [],
    skipped: [],
    knownCostYen: 9_000_000,
    budgetRemainingYen: 1_000_000,
    overBudget: false,
    costMissing: false,
    cells: [cell({})],
    shortages: [],
    missing: [],
    missingCostCount: 0,
    missingDemandCount: 0,
    missingCapacityCount: 0,
    hasMissing: false,
    hasShortage: false,
    status: "within",
    ...overrides,
  };
}

function snapshotScenario(
  slot: 0 | 1,
  name: string,
): PlanningScenarioSnapshot {
  return {
    ...scenario({ slot, name }),
    included: [],
    skipped: [],
  };
}

function proposal(
  overrides: Partial<PlanningProposalComplete> = {},
): PlanningProposalComplete {
  return {
    id: 1,
    version: 2,
    status: "pending_decision",
    submitterUserId: 10,
    submitterName: "田中 太郎",
    submittedAt: "2026-11-16T09:00:00.000Z",
    finalApproverUserId: 30,
    finalApproverName: "山田 部長",
    reviewerUserId: 20,
    reviewerName: "佐藤 花子",
    reviewOutcome: "passed",
    invalidReview: false,
    reviewedAt: "2026-11-17T09:00:00.000Z",
    decisionAction: null,
    decisionId: null,
    decidedByName: null,
    decidedAt: null,
    withdrawnByName: null,
    withdrawnAt: null,
    restricted: false,
    recommendedSlot: 1,
    recommendedScenarioName: "B案",
    periodRevision: 3,
    budgetYen: 10_000_000,
    reason: "2月のDB担当の不足を解消するため。",
    reviewNote: "全月で配賦枠内に収まることを確認しました。",
    decisionNote: null,
    withdrawReason: null,
    snapshot: {
      version: 1,
      period: {
        id: 1,
        year: 2027,
        quarter: 1,
        label: "2027年 1月–3月",
        budgetYen: 10_000_000,
        revision: 3,
      },
      roles: [],
      scenarios: [
        snapshotScenario(0, "A案"),
        snapshotScenario(1, "B案"),
      ],
      chosenSlot: 1,
    },
    ...overrides,
  };
}

test("comparisonOverview uses the fixed calculation and counts candidates", () => {
  const overview = comparisonOverview({
    budgetYen: 10_000_000,
    fixed: scenario({ knownCostYen: 6_000_000 }),
    initiatives: [
      { kind: "fixed" },
      { kind: "candidate" },
      { kind: "candidate" },
    ],
  });
  assert.deepEqual(overview, {
    budgetManYen: "1,000",
    fixedManYen: "600",
    candidateCount: 2,
    fixedCostMissing: false,
  });
  assert.equal(
    comparisonOverview({
      budgetYen: 10_000_000,
      fixed: scenario({ costMissing: true }),
      initiatives: [],
    }).fixedCostMissing,
    true,
  );
  assert.equal(
    comparisonOverview({
      budgetYen: 10_000_000,
      fixed: null,
      initiatives: [],
    }).fixedManYen,
    "—",
  );
});

test("budgetUsagePercent clamps to the bar and handles a zero budget", () => {
  assert.equal(budgetUsagePercent(9_000_000, 10_000_000), 90);
  assert.equal(budgetUsagePercent(12_000_000, 10_000_000), 100);
  assert.equal(budgetUsagePercent(1, 3), 33.3);
  assert.equal(budgetUsagePercent(100, 0), 0);
  assert.equal(budgetUsagePercent(Number.NaN, 100), 0);
});

test("primaryCapacityGap picks the largest shortage with a month label", () => {
  assert.deepEqual(
    primaryCapacityGap(
      scenario({
        shortages: [
          shortage({ monthIndex: 1, shortageDays: 4 }),
          shortage({ monthIndex: 2, shortageDays: 5, roleName: "開発担当" }),
        ],
      }),
      1,
    ),
    { tone: "danger", text: "2月 開発担当 5人日 不足" },
  );

  // A later month only wins when it has the same number of missing days.
  assert.equal(
    primaryCapacityGap(
      scenario({
        shortages: [
          shortage({ monthIndex: 2, shortageDays: 4 }),
          shortage({ monthIndex: 1, shortageDays: 4 }),
        ],
      }),
      10,
    ).text,
    "10月 DB担当 4人日 不足",
  );
});

test("primaryCapacityGap distinguishes a known zero from unset inputs", () => {
  assert.deepEqual(primaryCapacityGap(scenario(), 1), {
    tone: "success",
    text: "人員の不足なし",
  });
  assert.deepEqual(
    primaryCapacityGap(
      scenario({ missingCapacityCount: 1, hasMissing: true, status: "unknown" }),
      1,
    ),
    { tone: "warning", text: "需給は未判定（未設定あり）" },
  );
});

test("proposalAttentionLabel names the viewer only when they must act", () => {
  assert.equal(proposalAttentionLabel(proposal(), 30), "あなたの決裁待ち");
  assert.equal(proposalAttentionLabel(proposal(), 10), "最終承認待ち");
  assert.equal(
    proposalAttentionLabel(proposal({ status: "under_review", reviewOutcome: null }), 20),
    "あなたのレビュー待ち",
  );
  assert.equal(
    proposalAttentionLabel(proposal({ status: "under_review", reviewOutcome: null }), 10),
    "レビュー待ち",
  );
  assert.equal(proposalAttentionLabel(proposal({ status: "submitted" }), 10), "申請中");
  assert.equal(proposalAttentionLabel(proposal({ status: "approved" }), 10), "承認済み");
});

test("approvalFlowStages marks completed, current and future stages", () => {
  const stages = approvalFlowStages(proposal(), 30);
  assert.deepEqual(stages, [
    { key: "submit", label: "申請", person: "田中 太郎", state: "done" },
    { key: "review", label: "レビュー", person: "佐藤 花子", state: "done" },
    { key: "decision", label: "決裁", person: "あなた", state: "current" },
  ]);

  const reviewing = approvalFlowStages(
    proposal({ status: "under_review", reviewOutcome: null }),
    20,
  );
  assert.deepEqual(
    reviewing.map((stage) => `${stage.key}:${stage.state}`),
    ["submit:done", "review:current", "decision:upcoming"],
  );

  const skipped = approvalFlowStages(
    proposal({ reviewerUserId: null, reviewerName: null, reviewOutcome: "not_required" }),
    30,
  );
  assert.deepEqual(
    skipped.map((stage) => stage.key),
    ["submit", "decision"],
  );
  assert.equal(skipped[1]?.state, "current");
  assert.equal(skipped[1]?.person, "あなた");

  const approved = approvalFlowStages(proposal({ status: "approved" }), 10);
  assert.deepEqual(
    approved.map((stage) => stage.state),
    ["done", "done", "done"],
  );
});

test("previousReturnedProposal links only to an older returned version", () => {
  const current = proposal();
  const olderReturned = proposal({
    id: 2,
    version: 1,
    status: "returned",
  });
  const otherReturned = proposal({
    id: 3,
    version: 3,
    status: "returned",
  });
  const deferred = proposal({ id: 4, version: 2, status: "deferred" });
  assert.equal(
    previousReturnedProposal(
      [current, olderReturned, otherReturned, deferred],
      current,
    )?.id,
    2,
  );
  assert.equal(
    previousReturnedProposal([current, otherReturned], current),
    null,
  );
});

test("proposalPanelTitle falls back for a restricted proposal", () => {
  assert.equal(proposalPanelTitle(proposal()), "B案の採用申請");
  const restricted: PlanningProposalRestricted = {
    id: 9,
    version: 1,
    status: "pending_decision",
    submitterUserId: 10,
    submitterName: "田中 太郎",
    submittedAt: "2026-11-16T09:00:00.000Z",
    finalApproverUserId: 30,
    finalApproverName: "山田 部長",
    reviewerUserId: null,
    reviewerName: null,
    reviewOutcome: "not_required",
    invalidReview: false,
    reviewedAt: null,
    decisionAction: null,
    decisionId: null,
    decidedByName: null,
    decidedAt: null,
    withdrawnByName: null,
    withdrawnAt: null,
    restricted: true,
  };
  assert.equal(proposalPanelTitle(restricted), "投資提案の承認");
  assert.equal(
    proposalPanelTitle(restricted as PlanningProposal),
    "投資提案の承認",
  );
});
