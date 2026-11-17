import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { parsePortfolioId, readObjectBody, requireWorkspaceId } from "@/lib/planning/http";
import { updateApprovalSettings } from "@/lib/planning/mutations";
import { parseBoolean, parseNullablePositiveId } from "@/lib/planning/validation";

export const PUT = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const body = await readObjectBody(req);
  const enabled = parseBoolean(
    body.enabled ?? body.approvalsEnabled ?? body.approvals_enabled,
    "承認フローの設定",
  );
  const finalApproverUserId = parseNullablePositiveId(
    body.finalApproverUserId ?? body.finalApproverId ?? body.final_approver_user_id,
    "最終承認者",
  );
  const reviewerUserId = parseNullablePositiveId(
    body.reviewerUserId ?? body.reviewerId ?? body.reviewer_user_id,
    "レビュー担当",
  );
  const result = await updateApprovalSettings({
    workspaceId,
    portfolioId,
    userId: uid,
    enabled,
    finalApproverUserId,
    reviewerUserId,
  });
  await audit(uid, "portfolio_plan.approval_settings_update", {
    entity: "portfolio",
    entityId: portfolioId,
    summary: enabled
      ? `enabled:approver:${finalApproverUserId ?? "none"}:reviewer:${reviewerUserId ?? "none"}`
      : "disabled",
  });
  return NextResponse.json(result);
});
