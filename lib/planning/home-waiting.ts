import { db } from "../db";
import { loadPlanningAccess } from "./access";
import {
  effectiveProposalStatus,
  isOpenProposalStatus,
  proposalDecisionStageLabel,
  proposalReviewStageLabel,
} from "./approvals";
import { periodKey as makePeriodKey, periodLabel } from "./format";
import type {
  PlanningProposalReviewOutcome,
  PlanningProposalStatus,
} from "./types";

export type HomeWaitingProposal = {
  id: number;
  portfolioId: number;
  portfolioName: string;
  version: number;
  status: Extract<PlanningProposalStatus, "under_review" | "pending_decision">;
  stageLabel: string;
  periodLabel: string;
  periodKey: string;
  submitterName: string;
  submittedAt: string;
  budgetYen: number;
  mode: "review" | "decision";
  href: string;
};

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function reviewOutcome(value: unknown): PlanningProposalReviewOutcome | null {
  return value === "passed" || value === "returned" || value === "not_required"
    ? value
    : null;
}

/**
 * Open proposals waiting on this user, newest first.
 *
 * The candidate rows are narrowed in SQL to the two assignments that need
 * action, then mapped through the shared effective-status helpers so legacy
 * 'submitted' rows keep their established meaning. A proposal is returned only
 * after loadPlanningAccess confirms the viewer may open that portfolio's plan;
 * this reuses the same permission decision as the planning routes.
 *
 * Only workflow metadata is selected. The frozen snapshot (project names,
 * scenario contents) never leaves the database for this card.
 */
export async function getHomeWaitingProposals(
  workspaceId: number,
  userId: number,
  limit = 3,
): Promise<HomeWaitingProposal[]> {
  const result = await db.query(
    `SELECT p.id, p.portfolio_id, pf.name AS portfolio_name,
       per.year, per.quarter, p.version, p.status, p.review_outcome,
       p.reviewer_user_id, p.final_approver_user_id, p.submitted_by_name,
       p.submitted_at::text AS submitted_at, p.budget_yen
     FROM portfolio_plan_proposals p
     JOIN portfolios pf
       ON pf.id = p.portfolio_id AND pf.workspace_id = p.workspace_id
     JOIN portfolio_plan_periods per
       ON per.id = p.period_id
       AND per.portfolio_id = p.portfolio_id
       AND per.workspace_id = p.workspace_id
     WHERE p.workspace_id = $1::bigint
       AND (
         (p.final_approver_user_id = $2::bigint
           AND (p.status = 'pending_decision'
             OR (p.status = 'submitted' AND p.reviewer_user_id IS NULL)))
         OR (p.reviewer_user_id = $2::bigint
           AND p.status IN ('submitted', 'under_review'))
       )
     ORDER BY p.submitted_at DESC, p.id DESC
     LIMIT 30`,
    [workspaceId, userId],
  );

  const accessByPortfolio = new Map<number, boolean>();
  const waiting: HomeWaitingProposal[] = [];
  for (const row of result.rows) {
    const reviewerId = nullableNumber(row.reviewer_user_id);
    const status = effectiveProposalStatus(
      String(row.status) as PlanningProposalStatus,
      reviewerId,
    );
    if (!isOpenProposalStatus(status)) continue;

    const finalApproverId = Number(row.final_approver_user_id);
    const isReview = status === "under_review" && reviewerId === userId;
    const isDecision = status === "pending_decision" && finalApproverId === userId;
    if (!isReview && !isDecision) continue;

    const portfolioId = Number(row.portfolio_id);
    let canView = accessByPortfolio.get(portfolioId);
    if (canView === undefined) {
      const access = await loadPlanningAccess(db, portfolioId, workspaceId, userId);
      canView = access?.canView === true;
      accessByPortfolio.set(portfolioId, canView);
    }
    if (!canView) continue;

    const year = Number(row.year);
    const quarter = Number(row.quarter) as 1 | 2 | 3 | 4;
    const key = makePeriodKey(year, quarter);
    waiting.push({
      id: Number(row.id),
      portfolioId,
      portfolioName: String(row.portfolio_name),
      version: Number(row.version),
      status: isReview ? "under_review" : "pending_decision",
      stageLabel: isReview
        ? proposalReviewStageLabel(reviewerId, reviewOutcome(row.review_outcome))
        : proposalDecisionStageLabel(status),
      periodLabel: periodLabel(year, quarter),
      periodKey: key,
      submitterName: String(row.submitted_by_name),
      submittedAt: String(row.submitted_at),
      budgetYen: Number(row.budget_yen),
      mode: isReview ? "review" : "decision",
      href: `/portfolio/${portfolioId}/planning?view=compare&period=${encodeURIComponent(key)}#proposal-history`,
    });
    if (waiting.length >= limit) break;
  }
  return waiting;
}
