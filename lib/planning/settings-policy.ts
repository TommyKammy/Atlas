import type { Queryable } from "../db";
import { getEffectiveRole } from "../permissions";
import { loadEligiblePlanParticipants } from "./access";
import type { ApprovalSettingsValues } from "./approvals";
import type { PlanningApprovalSettings } from "./types";

export type PlanActor = { workspaceId: number; portfolioId: number; userId: number };

export function describeSettings(values: ApprovalSettingsValues, names?: { approver: string | null; reviewer: string | null }) {
  if (!values.enabled) return "無効";
  const label = (id: number | null, name?: string | null) =>
    id === null ? "なし" : [name, "#" + id].filter(Boolean).join(" ");
  return "有効（最終承認者 " + label(values.finalApproverUserId, names?.approver) +
    "、レビュー担当 " + label(values.reviewerUserId, names?.reviewer) + "）";
}

export async function pendingChange(q: Queryable, portfolioId: number) {
  const { rows } = await q.query(
    `SELECT c.id, c.requested_by, c.enabled, c.approver_id, c.reviewer_id,
            requester.name AS requester_name, approver.name AS approver_name, reviewer.name AS reviewer_name
     FROM portfolio_plan_approval_changes c
     LEFT JOIN users requester ON requester.id = c.requested_by
     LEFT JOIN users approver ON approver.id = c.approver_id
     LEFT JOIN users reviewer ON reviewer.id = c.reviewer_id
     WHERE c.portfolio_id = $1`, [portfolioId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    requestedBy: Number(row.requested_by),
    requesterName: row.requester_name as string | null,
    approverName: row.approver_name as string | null,
    reviewerName: row.reviewer_name as string | null,
    enabled: row.enabled === true,
    finalApproverUserId: row.approver_id === null ? null : Number(row.approver_id),
    reviewerUserId: row.reviewer_id === null ? null : Number(row.reviewer_id),
  };
}

export async function canConfirmChange(q: Queryable, actor: PlanActor, current: PlanningApprovalSettings,
  change: NonNullable<Awaited<ReturnType<typeof pendingChange>>>) {
  if (actor.userId === change.requestedBy) return false;
  const currentId = current.finalApprover?.id;
  if (currentId && (await loadEligiblePlanParticipants(q, actor.portfolioId, actor.workspaceId, currentId)).length) {
    return currentId === actor.userId;
  }
  // An independent super admin may replace a lost approver, keeping approval enabled.
  return change.enabled && change.finalApproverUserId !== currentId &&
    (await getEffectiveRole(actor.userId, q))?.isSuper === true;
}
