import type { PlanningProposalStatus } from "./types";

export const OPEN_PROPOSAL_STATUSES = ["submitted", "under_review"] as const;

export function isOpenProposalStatus(status: PlanningProposalStatus): boolean {
  return OPEN_PROPOSAL_STATUSES.some((openStatus) => openStatus === status);
}

export function proposalStatusLabel(status: PlanningProposalStatus): string {
  switch (status) {
    case "submitted":
      return "最終承認待ち";
    case "under_review":
      return "レビュー中";
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
