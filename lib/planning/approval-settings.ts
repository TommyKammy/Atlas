import { ApiError, badRequest, conflict, forbidden } from "../api/errors";
import { withTransaction, type Queryable } from "../db";
import { audit } from "../audit";
import { loadEligiblePlanParticipants, lockPlanningPortfolio, requirePlanningAccess, requirePlanningEditor } from "./access";
import { approvalSettingsChanged, reviewerConflicts, type ApprovalSettingsValues } from "./approvals";
import { loadApprovalSettings } from "./repository";
import { canConfirmChange, describeSettings, pendingChange, type PlanActor } from "./settings-policy";
import type { PlanningApprovalSettings } from "./types";

function values(settings: PlanningApprovalSettings): ApprovalSettingsValues {
  return {
    enabled: settings.enabled,
    finalApproverUserId: settings.finalApprover?.id ?? null,
    reviewerUserId: settings.reviewer?.id ?? null,
  };
}

async function validate(q: Queryable, actor: PlanActor, current: PlanningApprovalSettings, next: ApprovalSettingsValues) {
  if (current.openProposalCount > 0) {
    throw new ApiError(409, "未解決の投資提案があるため、承認設定を変更できません", "approval_settings_locked",
      { openProposalCount: current.openProposalCount });
  }
  if (!next.enabled) return;
  if (reviewerConflicts(next.reviewerUserId, null, next.finalApproverUserId)) {
    throw conflict("レビュー担当と最終承認者は別の人を指定してください");
  }
  const candidates = await loadEligiblePlanParticipants(q, actor.portfolioId, actor.workspaceId);
  if (!candidates.some(u => u.id === next.finalApproverUserId)) throw badRequest("有効な最終承認者を選択してください");
  if (next.reviewerUserId !== null && !candidates.some(u => u.id === next.reviewerUserId)) {
    throw badRequest("有効なレビュー担当を選択してください");
  }
}

async function record(q: Queryable, actor: PlanActor, action: string, summary: string) {
  await audit(actor.userId, "portfolio_plan.approval_settings_" + action, {
    workspaceId: actor.workspaceId, entity: "portfolio", entityId: actor.portfolioId,
    summary: "ポートフォリオ #" + actor.portfolioId + " / " + summary + " ／ 操作者 #" + actor.userId,
  }, q);
}

async function apply(q: Queryable, actor: PlanActor, next: ApprovalSettingsValues) {
  await q.query(
    `INSERT INTO portfolio_plan_approval_settings
       (portfolio_id, workspace_id, approvals_enabled, final_approver_user_id, default_reviewer_user_id, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (portfolio_id) DO UPDATE SET approvals_enabled = EXCLUDED.approvals_enabled,
       final_approver_user_id = EXCLUDED.final_approver_user_id,
       default_reviewer_user_id = EXCLUDED.default_reviewer_user_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [actor.portfolioId, actor.workspaceId, next.enabled, next.finalApproverUserId, next.reviewerUserId, actor.userId],
  );
}

export async function updateApprovalSettings(input: PlanActor & ApprovalSettingsValues & { requestChange: boolean }) {
  return withTransaction(async q => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const current = await loadApprovalSettings(q, input.portfolioId);
    const before = values(current);
    const next = {
      enabled: input.enabled,
      finalApproverUserId: input.enabled ? input.finalApproverUserId : null,
      reviewerUserId: input.enabled ? input.reviewerUserId : null,
    };
    if (!approvalSettingsChanged(before, next)) return { ...before, pendingId: null };
    await validate(q, input, current, next);
    const summary = describeSettings(before) + " → " + describeSettings(next);
    if (current.enabled) {
      if (!input.requestChange) throw conflict("設定変更には別の担当者による承認が必要です");
      const existing = await pendingChange(q, input.portfolioId);
      if (existing) {
        if (existing.requestedBy === input.userId && !approvalSettingsChanged(existing, next)) {
          return { ...before, pendingId: existing.id };
        }
        throw conflict("承認待ちの設定変更があります");
      }
      const currentId = current.finalApprover?.id;
      const eligible = currentId && (await loadEligiblePlanParticipants(
        q, input.portfolioId, input.workspaceId, currentId,
      )).length > 0;
      if (eligible && currentId === input.userId) {
        throw forbidden("現行の最終承認者はこの変更を承認するため、別の編集者が申請してください");
      }
      if (!eligible && (!next.enabled || next.finalApproverUserId === currentId)) {
        throw conflict("現行の最終承認者が不在です。別の最終承認者への変更を申請し、独立したスーパー管理者の承認を受けてください");
      }
      const result = await q.query(
        `INSERT INTO portfolio_plan_approval_changes(portfolio_id, requested_by, enabled, approver_id, reviewer_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [input.portfolioId, input.userId, next.enabled, next.finalApproverUserId, next.reviewerUserId],
      );
      const pendingId = Number(result.rows[0].id);
      await record(q, input, "request", "変更申請 #" + pendingId + " " + summary);
      return { ...before, pendingId };
    }
    await apply(q, input, next);
    await record(q, input, "update", summary);
    return { ...next, pendingId: null };
  });
}

export async function resolveApprovalChange(actor: PlanActor, id: number, action: "confirm" | "cancel") {
  return withTransaction(async q => {
    await lockPlanningPortfolio(q, actor.portfolioId, actor.workspaceId);
    const access = await requirePlanningAccess(q, actor.portfolioId, actor.workspaceId, actor.userId);
    const current = await loadApprovalSettings(q, actor.portfolioId);
    const change = await pendingChange(q, actor.portfolioId);
    if (change?.id !== id) throw conflict("この変更申請はすでに解決されています");
    const approver = await canConfirmChange(q, actor, current, change);
    const summary = "変更申請 #" + id + "（申請者 #" + change.requestedBy + "） " +
      describeSettings(values(current)) + " → " + describeSettings(change);
    if (action === "confirm") {
      if (!approver) throw forbidden("この設定変更を承認する権限がありません");
      await requirePlanningEditor(q, actor.portfolioId, actor.workspaceId, change.requestedBy);
      const requester = await q.query("SELECT 1 FROM users WHERE id=$1 AND deactivated_at IS NULL", [change.requestedBy]);
      if (!requester.rowCount) throw conflict("申請者が無効です。変更申請を取り消してください");
      await validate(q, actor, current, change);
      await apply(q, actor, change);
      await record(q, actor, "update", summary);
    } else {
      if (!access.canEdit && !approver) throw forbidden();
      await record(q, actor, "cancel", summary);
    }
    await q.query("DELETE FROM portfolio_plan_approval_changes WHERE id=$1", [id]);
  });
}
