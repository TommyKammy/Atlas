import type { PlanningScenarioResult } from "./calculations";

export const PLANNING_QUARTERS = [1, 2, 3, 4] as const;
export type PlanningQuarter = (typeof PLANNING_QUARTERS)[number];

export const PLANNING_MONTHS = [1, 2, 3] as const;
export type PlanningMonth = (typeof PLANNING_MONTHS)[number];

export type PlanningInitiativeKind = "fixed" | "candidate";

export type PlanningView = "ledger" | "capacity" | "compare";

export function parsePlanningView(value: string | null | undefined): PlanningView {
  return value === "capacity" || value === "compare" ? value : "ledger";
}

export type PlanningPeriodSummary = {
  id: number;
  year: number;
  quarter: PlanningQuarter;
  budgetYen: number;
  revision: number;
  label: string;
  startMonth: number;
};

export type PlanningRole = {
  id: number;
  name: string;
  position: number;
};

export type PlanningCapacity = {
  roleId: number;
  monthIndex: PlanningMonth;
  days: number;
};

export type PlanningDemand = {
  roleId: number;
  monthIndex: PlanningMonth;
  days: number;
};

export type PlanningInitiative = {
  id: number;
  name: string;
  /** Null only for legacy free-text owners that have not been associated yet. */
  ownerMemberId: number | null;
  /** Stored at save time; never recomputed from the current account name on read. */
  ownerName: string;
  expectedEffect: string;
  kind: PlanningInitiativeKind;
  linkedProjectId: number | null;
  linkedProjectName: string | null;
  costYen: number | null;
  demands: PlanningDemand[];
};

export type PlanningScenario = {
  id: number;
  slot: 0 | 1;
  name: string;
  selectedInitiativeIds: number[];
};

/** An initiative entity that has no estimate in the selected period yet. */
export type PlanningCarryover = {
  id: number;
  name: string;
  ownerName: string;
  expectedEffect: string;
  kind: PlanningInitiativeKind;
  linkedProjectId: number | null;
  linkedProjectName: string | null;
};

export type PlanningViewer = {
  id: number;
  name: string;
  email: string | null;
  grantedAt: string;
};

export type PlanningViewerCandidate = {
  id: number;
  name: string;
  email: string | null;
};

/** Editor-only workspace directory used by the initiative owner picker. */
export type PlanningOwnerCandidate = {
  id: number;
  name: string;
  email: string | null;
};

export type PlanningProjectOption = {
  id: number;
  name: string;
};

export type PlanningSnapshotDemand = {
  roleId: number;
  roleName: string;
  monthIndex: PlanningMonth;
  /** null means unestimated; 0 is an explicit zero. */
  days: number | null;
};

export type PlanningSnapshotInitiative = {
  id: number;
  name: string;
  ownerName: string;
  expectedEffect: string;
  kind: PlanningInitiativeKind;
  linkedProjectId: number | null;
  linkedProjectName: string | null;
  costYen: number | null;
  demands: PlanningSnapshotDemand[];
};

export type PlanningSnapshotCell = {
  roleId: number;
  roleName: string;
  monthIndex: PlanningMonth;
  demandDays: number;
  demandMissing: boolean;
  capacityDays: number | null;
  capacityMissing: boolean;
  gapDays: number | null;
  shortageDays: number;
  demandComplete: boolean;
};

export type PlanningSnapshotShortage = {
  roleId: number;
  roleName: string;
  monthIndex: PlanningMonth;
  shortageDays: number;
  demandMissing: boolean;
};

export type PlanningMissingItem =
  | { kind: "cost"; initiativeName: string }
  | { kind: "demand"; initiativeName: string; roleName: string; monthIndex: PlanningMonth }
  | { kind: "capacity"; roleName: string; monthIndex: PlanningMonth };

export type PlanningScenarioSnapshot = {
  slot: 0 | 1;
  name: string;
  included: PlanningSnapshotInitiative[];
  skipped: PlanningSnapshotInitiative[];
  knownCostYen: number;
  budgetRemainingYen: number;
  overBudget: boolean;
  costMissing: boolean;
  cells: PlanningSnapshotCell[];
  shortages: PlanningSnapshotShortage[];
  missing: PlanningMissingItem[];
  missingCostCount: number;
  missingDemandCount: number;
  missingCapacityCount: number;
  hasMissing: boolean;
  hasShortage: boolean;
  status: "within" | "needs_attention" | "unknown";
};

export type PlanningDecisionSnapshot = {
  version: 1;
  period: {
    id: number;
    year: number;
    quarter: PlanningQuarter;
    label: string;
    budgetYen: number;
    revision: number;
  };
  roles: { id: number; name: string }[];
  scenarios: [PlanningScenarioSnapshot, PlanningScenarioSnapshot];
  chosenSlot: 0 | 1;
};

export type PlanningDecisionRestricted = {
  id: number;
  chosenSlot: 0 | 1;
  chosenScenarioName: string;
  actorName: string;
  decidedAt: string;
  periodRevision: number;
  budgetYen: number;
  restricted: true;
  reason: null;
  snapshot: null;
};

export type PlanningDecisionComplete = {
  id: number;
  chosenSlot: 0 | 1;
  chosenScenarioName: string;
  actorName: string;
  decidedAt: string;
  periodRevision: number;
  budgetYen: number;
  restricted: false;
  reason: string;
  snapshot: PlanningDecisionSnapshot;
};

export type PlanningDecision = PlanningDecisionRestricted | PlanningDecisionComplete;

export type PlanningProposalStatus =
  | "submitted"
  | "under_review"
  | "returned"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "superseded";

export type PlanningApprovalParticipant = {
  id: number;
  name: string;
};

export type PlanningApprovalCandidate = PlanningApprovalParticipant & {
  email: string | null;
};

export type PlanningApprovalSettings = {
  enabled: boolean;
  finalApprover: PlanningApprovalParticipant | null;
  reviewer: PlanningApprovalParticipant | null;
  /** In-flight proposals across the portfolio; settings cannot be redirected while nonzero. */
  openProposalCount: number;
};

type PlanningProposalBase = {
  id: number;
  version: number;
  status: PlanningProposalStatus;
  recommendedSlot: 0 | 1;
  recommendedScenarioName: string;
  submitterName: string;
  submittedAt: string;
  periodRevision: number;
  budgetYen: number;
  finalApproverName: string;
  reviewerName: string | null;
  restricted: boolean;
};

export type PlanningProposalRestricted = PlanningProposalBase & {
  restricted: true;
  reason: null;
  snapshot: null;
};

export type PlanningProposalComplete = PlanningProposalBase & {
  restricted: false;
  reason: string;
  snapshot: PlanningDecisionSnapshot;
};

export type PlanningProposal = PlanningProposalRestricted | PlanningProposalComplete;

export type PlanningComparisonProjection = {
  revision: number;
  budgetYen: number;
  fixed: PlanningScenarioResult;
  scenarios: [PlanningScenarioResult, PlanningScenarioResult];
};

export type PlanningAccess = {
  canView: boolean;
  canEdit: boolean;
  canManageViewers: boolean;
  canEditData: boolean;
};

export type PlanningState = {
  portfolio: { id: number; name: string };
  access: PlanningAccess;
  periods: PlanningPeriodSummary[];
  selectedPeriod: PlanningPeriodSummary | null;
  roles: PlanningRole[];
  capacities: PlanningCapacity[];
  initiatives: PlanningInitiative[];
  /** Available only to editors; lets a new quarter reuse an existing entity. */
  carryovers: PlanningCarryover[];
  scenarios: [PlanningScenario, PlanningScenario] | null;
  /** Server projection for one authorized revision; null when restricted or no period. */
  comparison: PlanningComparisonProjection | null;
  decisions: PlanningDecision[];
  approval: PlanningApprovalSettings;
  proposals: PlanningProposal[];
  /** Editor-only eligible full-visibility members for approval settings. */
  approvalCandidates: PlanningApprovalCandidate[] | null;
  viewers: PlanningViewer[] | null;
  viewerCandidates: PlanningViewerCandidate[] | null;
  /** Editor-only active-member directory. Never included in read-only state. */
  ownerCandidates: PlanningOwnerCandidate[] | null;
  currentUserId: number;
  projects: PlanningProjectOption[];
  restricted: boolean;
  restrictedReason: string | null;
};
