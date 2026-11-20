import {
  effectiveProposalStatus,
  proposalStatusLabel,
} from "./approvals";
import { formatDays, formatManYen, monthLabelFromStart } from "./format";
import type { PlanningScenarioResult } from "./calculations";
import type {
  PlanningInitiativeKind,
  PlanningProposal,
} from "./types";

/**
 * Display-only summaries for the compare screen. None of these functions
 * change a scenario, a proposal or a decision; they only turn values the
 * server already calculated into the labels the C workbench layout shows.
 */

export type ComparisonOverview = {
  budgetManYen: string;
  fixedManYen: string;
  candidateCount: number;
  fixedCostMissing: boolean;
};

export function comparisonOverview(input: {
  budgetYen: number;
  fixed: PlanningScenarioResult | null;
  initiatives: readonly { kind: PlanningInitiativeKind }[];
}): ComparisonOverview {
  return {
    budgetManYen: formatManYen(input.budgetYen),
    fixedManYen: input.fixed ? formatManYen(input.fixed.knownCostYen) : "—",
    candidateCount: input.initiatives.filter(
      (initiative) => initiative.kind === "candidate",
    ).length,
    fixedCostMissing: input.fixed?.costMissing ?? false,
  };
}

/** Width of the budget bar in percent. Over-budget plans stay at 100%. */
export function budgetUsagePercent(
  knownCostYen: number,
  budgetYen: number,
): number {
  if (
    !Number.isFinite(knownCostYen) ||
    !Number.isFinite(budgetYen) ||
    budgetYen <= 0
  ) {
    return 0;
  }
  const percent = (Math.max(0, knownCostYen) / budgetYen) * 100;
  return Math.round(Math.min(100, percent) * 10) / 10;
}

export type CapacityGapSummary = {
  tone: "danger" | "warning" | "success";
  text: string;
};

/**
 * The one shortage line a scenario card shows. Known shortages win over
 * unset demand or capacity so a real gap is never hidden behind "unjudged".
 */
export function primaryCapacityGap(
  result: PlanningScenarioResult,
  startMonth: number,
): CapacityGapSummary {
  const worst = result.shortages.reduce<
    PlanningScenarioResult["shortages"][number] | null
  >((current, shortage) => {
    if (!current) return shortage;
    if (shortage.shortageDays > current.shortageDays) return shortage;
    if (
      shortage.shortageDays === current.shortageDays &&
      shortage.monthIndex < current.monthIndex
    ) {
      return shortage;
    }
    return current;
  }, null);

  if (worst) {
    return {
      tone: "danger",
      text: `${monthLabelFromStart(startMonth, worst.monthIndex)} ${worst.roleName} ${formatDays(worst.shortageDays)}人日 不足`,
    };
  }
  if (result.missingDemandCount > 0 || result.missingCapacityCount > 0) {
    return { tone: "warning", text: "需給は未判定（未設定あり）" };
  }
  return { tone: "success", text: "人員の不足なし" };
}

/**
 * The label above the decision panel title. It mirrors the existing proposal
 * vocabulary and only adds "あなたの" when the current viewer must act.
 */
export function proposalAttentionLabel(
  proposal: PlanningProposal,
  currentUserId: number,
): string {
  if (proposal.status === "submitted") return "申請中";
  const status = effectiveProposalStatus(
    proposal.status,
    proposal.reviewerUserId,
  );
  if (status === "pending_decision") {
    return proposal.finalApproverUserId === currentUserId
      ? "あなたの決裁待ち"
      : "最終承認待ち";
  }
  if (status === "under_review") {
    return proposal.reviewerUserId === currentUserId
      ? "あなたのレビュー待ち"
      : "レビュー待ち";
  }
  return proposalStatusLabel(status);
}

export type ApprovalFlowStageState = "done" | "current" | "upcoming";

export type ApprovalFlowStage = {
  key: "submit" | "review" | "decision";
  label: string;
  person: string;
  state: ApprovalFlowStageState;
};

function reviewStageState(
  proposal: PlanningProposal,
  status: PlanningProposal["status"],
): ApprovalFlowStageState {
  if (
    proposal.reviewOutcome === "passed" ||
    proposal.reviewOutcome === "returned" ||
    status === "pending_decision" ||
    status === "approved" ||
    status === "deferred"
  ) {
    return "done";
  }
  if (status === "under_review") return "current";
  return "upcoming";
}

function decisionStageState(
  status: PlanningProposal["status"],
): ApprovalFlowStageState {
  if (
    status === "approved" ||
    status === "deferred" ||
    status === "returned" ||
    status === "rejected"
  ) {
    return "done";
  }
  if (status === "pending_decision") return "current";
  return "upcoming";
}

/**
 * Build the 申請 → レビュー → 決裁 sequence for the open proposal. The review
 * stage is omitted when no reviewer is assigned, matching the stored workflow.
 */
export function approvalFlowStages(
  proposal: PlanningProposal,
  currentUserId: number,
): ApprovalFlowStage[] {
  const status = effectiveProposalStatus(
    proposal.status,
    proposal.reviewerUserId,
  );
  const stages: ApprovalFlowStage[] = [
    {
      key: "submit",
      label: "申請",
      person: proposal.submitterName,
      state: "done",
    },
  ];
  const reviewRequired =
    proposal.reviewerUserId !== null && proposal.reviewOutcome !== "not_required";
  if (reviewRequired) {
    stages.push({
      key: "review",
      label: "レビュー",
      person: proposal.reviewerName ?? "未設定",
      state: reviewStageState(proposal, status),
    });
  }
  stages.push({
    key: "decision",
    label: "決裁",
    person:
      proposal.finalApproverUserId === currentUserId
        ? "あなた"
        : proposal.finalApproverName,
    state: decisionStageState(status),
  });
  return stages;
}

/**
 * The newest returned version before the open one, used for the "previous
 * version was returned" link. Null when there is no earlier returned version.
 */
export function previousReturnedProposal(
  proposals: readonly PlanningProposal[],
  current: PlanningProposal,
): PlanningProposal | null {
  return (
    proposals
      .filter(
        (proposal) =>
          proposal.id !== current.id &&
          proposal.version < current.version &&
          proposal.status === "returned",
      )
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

/** Title under the decision-panel label. Restricted proposals have no name. */
export function proposalPanelTitle(proposal: PlanningProposal): string {
  if (proposal.restricted) return "投資提案の承認";
  return `${proposal.recommendedScenarioName}の採用申請`;
}
