import type {
  PlanningProposalDecisionAction,
  PlanningProposalReviewOutcome,
  PlanningProposalStatus,
} from "./types";

export const OPEN_PROPOSAL_STATUSES = [
  "submitted",
  "under_review",
  "pending_decision",
] as const;

export function isOpenProposalStatus(status: PlanningProposalStatus): boolean {
  return OPEN_PROPOSAL_STATUSES.some((openStatus) => openStatus === status);
}

export function proposalStatusLabel(status: PlanningProposalStatus): string {
  switch (status) {
    case "submitted":
      return "提出済み";
    case "under_review":
      return "レビュー待ち";
    case "pending_decision":
      return "最終承認待ち";
    case "deferred":
      return "今期は見送り";
    case "returned":
      return "差し戻し";
    case "approved":
      return "承認済み";
    case "rejected":
      return "却下";
    case "withdrawn":
      return "取下げ";
    case "superseded":
      return "新版に置換";
  }
}

export function proposalReviewOutcomeLabel(outcome: PlanningProposalReviewOutcome): string {
  switch (outcome) {
    case "passed":
      return "確認済み（決裁へ）";
    case "returned":
      return "差し戻し";
    case "not_required":
      return "レビュー不要";
  }
}

export type ProposalReviewAction = "pass" | "return";

export function proposalReviewOutcome(
  action: ProposalReviewAction,
): Extract<PlanningProposalReviewOutcome, "passed" | "returned"> {
  return action === "pass" ? "passed" : "returned";
}

export function proposalStatusAfterReview(action: ProposalReviewAction): PlanningProposalStatus {
  return action === "pass" ? "pending_decision" : "returned";
}

export function proposalStatusAfterDecision(
  action: PlanningProposalDecisionAction,
): PlanningProposalStatus {
  if (action === "approve") return "approved";
  if (action === "defer") return "deferred";
  return "returned";
}

export function proposalDecisionActionLabel(action: PlanningProposalDecisionAction): string {
  switch (action) {
    case "approve":
      return "承認して採用";
    case "defer":
      return "今期は見送る";
    case "return":
      return "差し戻す";
  }
}

/** Compact stage label used by the proposal list and detail. */
export function proposalReviewStageLabel(
  reviewerUserId: number | null,
  outcome: PlanningProposalReviewOutcome | null,
): string {
  if (reviewerUserId === null || outcome === "not_required") return "レビュー省略";
  if (outcome === "passed") return "レビュー確認済み";
  if (outcome === "returned") return "レビューで差し戻し";
  return "レビュー待ち";
}

export function proposalDecisionStageLabel(status: PlanningProposalStatus): string {
  switch (status) {
    case "pending_decision":
      return "最終決裁待ち";
    case "approved":
      return "承認済み";
    case "deferred":
      return "今期は見送り";
    case "returned":
      return "差し戻し";
    case "withdrawn":
      return "取下げ";
    case "superseded":
      return "新版に置換";
    case "rejected":
      return "却下";
    case "submitted":
    case "under_review":
      return "最終決裁前";
  }
}

export function proposalInitialStatus(reviewerUserId: number | null): PlanningProposalStatus {
  return reviewerUserId === null ? "pending_decision" : "under_review";
}

export function proposalInitialReviewOutcome(
  reviewerUserId: number | null,
): PlanningProposalReviewOutcome | null {
  return reviewerUserId === null ? "not_required" : null;
}

/**
 * Phase 1 stored every submission as 'submitted'. Treat it as the workflow
 * status it actually represents so existing in-flight rows and fixtures keep
 * working without rewriting submission columns.
 */
export function effectiveProposalStatus(
  status: PlanningProposalStatus,
  reviewerUserId: number | null,
): PlanningProposalStatus {
  if (status !== "submitted") return status;
  return reviewerUserId === null ? "pending_decision" : "under_review";
}

export type ProposalSubmissionBlock =
  | "approvals_disabled"
  | "approver_missing"
  | "self_approval"
  | "open_proposal";

export type ProposalSubmissionPolicy = {
  approvalsEnabled: boolean;
  finalApproverUserId: number | null;
  submitterUserId: number;
  openProposal: boolean;
};

/**
 * Submission-time separation-of-duties checks shared by the server and the
 * compare screen. Assignment eligibility is checked separately against the
 * current planning/project visibility directory.
 */
export function proposalSubmissionBlock(
  policy: ProposalSubmissionPolicy,
): ProposalSubmissionBlock | null {
  if (!policy.approvalsEnabled) return "approvals_disabled";
  if (policy.finalApproverUserId === null) return "approver_missing";
  if (policy.finalApproverUserId === policy.submitterUserId) return "self_approval";
  if (policy.openProposal) return "open_proposal";
  return null;
}

export type ApprovalSettingsValues = {
  enabled: boolean;
  finalApproverUserId: number | null;
  reviewerUserId: number | null;
};

/**
 * Any material approval configuration change is frozen while a submission is
 * in flight. Re-saving identical values stays allowed (and is a no-op).
 */
export function approvalSettingsChanged(
  current: ApprovalSettingsValues,
  next: ApprovalSettingsValues,
): boolean {
  return (
    current.enabled !== next.enabled ||
    current.finalApproverUserId !== next.finalApproverUserId ||
    current.reviewerUserId !== next.reviewerUserId
  );
}
