import type { Queryable } from "../db";
import type {
  PlanningProposalReviewOutcome,
  PlanningProposalStatus,
} from "./types";

/**
 * Scoped workflow transition for a submitted proposal. Callers lock the
 * portfolio and proposal row first; the expected statuses and optional reviewer
 * guard make stale or concurrent actions fail instead of overwriting a newer
 * workflow state. Submission fields stay immutable.
 */
export async function transitionProposalStatus(
  q: Queryable,
  input: {
    proposalId: number;
    workspaceId: number;
    portfolioId: number;
    expectedStatuses: readonly PlanningProposalStatus[];
    nextStatus: PlanningProposalStatus;
    reviewerUserId?: number;
    reviewOutcome?: PlanningProposalReviewOutcome;
    reviewNote?: string;
    reviewRequestId?: string | null;
    markReviewed?: boolean;
  },
): Promise<{
  id: number;
  version: number;
  status: PlanningProposalStatus;
  reviewedAt: string | null;
} | null> {
  const result = await q.query(
    `UPDATE portfolio_plan_proposals
     SET status = $5::text,
         review_outcome = COALESCE($6::text, review_outcome),
         review_note = COALESCE($7::text, review_note),
         review_request_id = COALESCE($8::text, review_request_id),
         reviewed_at = CASE WHEN $9::boolean THEN now() ELSE reviewed_at END
     WHERE id = $1::bigint
       AND workspace_id = $2::bigint
       AND portfolio_id = $3::bigint
       AND status = ANY($4::text[])
       AND ($10::bigint IS NULL OR reviewer_user_id = $10::bigint)
     RETURNING id, version, status, reviewed_at::text AS reviewed_at`,
    [
      input.proposalId,
      input.workspaceId,
      input.portfolioId,
      input.expectedStatuses,
      input.nextStatus,
      input.reviewOutcome ?? null,
      input.reviewNote ?? null,
      input.reviewRequestId ?? null,
      input.markReviewed ?? false,
      input.reviewerUserId ?? null,
    ],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: Number(row.id),
    version: Number(row.version),
    status: String(row.status) as PlanningProposalStatus,
    reviewedAt: row.reviewed_at === null || row.reviewed_at === undefined
      ? null
      : String(row.reviewed_at),
  };
}
