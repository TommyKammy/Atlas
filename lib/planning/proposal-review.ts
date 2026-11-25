import { ApiError, conflict, forbidden, notFound } from "../api/errors";
import { withTransaction } from "../db";
import { lockPlanningPortfolio, requirePlanningAccess, visibleProjectIds } from "./access";
import {
  effectiveProposalStatus,
  invalidProposalReview,
  isOpenProposalStatus,
  proposalReviewOutcome,
  proposalStatusAfterReview,
  type ProposalReviewAction,
} from "./approvals";
import { recordPlanAction } from "./audit";
import { hashPlanningSnapshot, isPlanningDecisionSnapshot, snapshotProjectIds } from "./decision-snapshot";
import { transitionProposalStatus } from "./proposal-transition";
import type { PlanningProposalReviewOutcome, PlanningProposalStatus } from "./types";

export async function reviewProposal(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  proposalId: number;
  action: ProposalReviewAction;
  note: string;
  requestId: string | null;
  expectedStatus: PlanningProposalStatus | null;
}): Promise<{
  id: number;
  version: number;
  status: PlanningProposalStatus;
  outcome: PlanningProposalReviewOutcome;
  reviewedAt: string;
  idempotent: boolean;
}> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningAccess(q, input.portfolioId, input.workspaceId, input.userId);

    const active = await q.query(
      "SELECT id FROM users WHERE id = $1::bigint AND deactivated_at IS NULL",
      [input.userId],
    );
    if (active.rowCount === 0) throw forbidden("実行者が存在しないか無効です");

    const loaded = await q.query(
      `SELECT (SELECT default_reviewer_user_id FROM portfolio_plan_approval_settings
                 WHERE portfolio_id = $2::bigint) AS required_reviewer_id, id, version, status, reviewer_user_id, submitted_by, final_approver_user_id, review_outcome, review_note,
         reviewed_at::text AS reviewed_at, review_request_id, snapshot, snapshot_sha256
       FROM portfolio_plan_proposals
       WHERE id = $1::bigint
         AND portfolio_id = $2::bigint
         AND workspace_id = $3::bigint
       FOR UPDATE`,
      [input.proposalId, input.portfolioId, input.workspaceId],
    );
    if (loaded.rowCount === 0) throw notFound("投資提案が見つかりません");
    const row = loaded.rows[0];
    const reviewerUserId =
      row.reviewer_user_id === null || row.reviewer_user_id === undefined
        ? null
        : Number(row.reviewer_user_id);
    const rawStatus = String(row.status) as PlanningProposalStatus;
    const status = effectiveProposalStatus(rawStatus, reviewerUserId);
    const outcome = proposalReviewOutcome(input.action);

    if (reviewerUserId === null) {
      throw conflict("この提案にはレビュー担当者が設定されていません", "reviewer_unassigned");
    }
    if (reviewerUserId !== input.userId) {
      throw forbidden("この提案をレビューできるのは、割り当てられたレビュー担当者だけです");
    }

    if (isOpenProposalStatus(status) && invalidProposalReview(
      reviewerUserId, Number(row.submitted_by), Number(row.final_approver_user_id),
      row.required_reviewer_id === null ? null : Number(row.required_reviewer_id),
    )) {
      throw conflict("レビュー担当の割当が不正です。提案を取り下げ、別の担当者で再提出してください");
    }
    const snapshot = row.snapshot;
    if (
      !isPlanningDecisionSnapshot(snapshot) ||
      hashPlanningSnapshot(snapshot) !== String(row.snapshot_sha256)
    ) {
      throw conflict("提案の内容を確認できませんでした", "proposal_snapshot_invalid");
    }
    const projectIds = snapshotProjectIds(snapshot);
    const visible = await visibleProjectIds(q, input.userId, input.workspaceId, projectIds);
    if (projectIds.some((projectId) => !visible.has(projectId))) {
      throw forbidden(
        "閲覧権限のない元プロジェクトが含まれるため、この提案をレビューできません。全案件の元プロジェクト閲覧権限が必要です",
      );
    }

    if (input.requestId !== null && row.review_request_id === input.requestId) {
      if (
        reviewerUserId !== input.userId ||
        String(row.review_note ?? "") !== input.note ||
        row.review_outcome !== outcome ||
        row.reviewed_at === null ||
        row.reviewed_at === undefined
      ) {
        throw new ApiError(
          409,
          "同じリクエストIDが別のレビュー内容で使用されています",
          "request_id_reused",
        );
      }
      return {
        id: Number(row.id),
        version: Number(row.version),
        status,
        outcome,
        reviewedAt: String(row.reviewed_at),
        idempotent: true,
      };
    }

    if (
      input.expectedStatus !== null &&
      input.expectedStatus !== status &&
      input.expectedStatus !== rawStatus
    ) {
      throw new ApiError(
        409,
        "提案の状態が変わりました。最新の内容を確認してください",
        "proposal_status_changed",
        { currentStatus: status },
      );
    }
    if (status !== "under_review") {
      throw new ApiError(
        409,
        "この提案はレビュー待ちではありません。最新の内容を確認してください",
        "proposal_status_changed",
        { currentStatus: status },
      );
    }

    const nextStatus = proposalStatusAfterReview(input.action);
    const transitioned = await transitionProposalStatus(q, {
      proposalId: input.proposalId,
      workspaceId: input.workspaceId,
      portfolioId: input.portfolioId,
      expectedStatuses: ["submitted", "under_review"],
      nextStatus,
      reviewerUserId: input.userId,
      reviewOutcome: outcome,
      reviewNote: input.note,
      reviewRequestId: input.requestId,
      markReviewed: true,
    });
    if (!transitioned) {
      throw new ApiError(
        409,
        "提案の状態が変わりました。最新の内容を確認してください",
        "proposal_status_changed",
        { currentStatus: status },
      );
    }

    await recordPlanAction(q, input, "proposal_review", "portfolio_plan_proposal", input.proposalId, "v" + transitioned.version + " / " + outcome);
    return {
      id: transitioned.id,
      version: transitioned.version,
      status: transitioned.status,
      outcome,
      reviewedAt: transitioned.reviewedAt ?? new Date().toISOString(),
      idempotent: false,
    };
  });
}
