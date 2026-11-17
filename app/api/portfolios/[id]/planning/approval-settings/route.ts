import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { parsePortfolioId, readObjectBody, requireWorkspaceId } from "@/lib/planning/http";
import { resolveApprovalChange, updateApprovalSettings } from "@/lib/planning/approval-settings";
import { parseBoolean, parseNullablePositiveId, parsePositiveId } from "@/lib/planning/validation";

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
    requestChange: body.requestChange === true,
    enabled,
    finalApproverUserId,
    reviewerUserId,
  });
  return NextResponse.json(result, { status: result.pendingId ? 202 : 200 });
});

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const body = await readObjectBody(req);
  if (body.action !== "confirm" && body.action !== "cancel") {
    return NextResponse.json({ error: "設定変更の操作が不正です" }, { status: 400 });
  }
  await resolveApprovalChange({ workspaceId, portfolioId, userId: uid },
    parsePositiveId(body.changeId, "変更申請"), body.action);
  return NextResponse.json({ ok: true });
});
