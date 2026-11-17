import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { parsePortfolioId, readObjectBody, requireWorkspaceId } from "@/lib/planning/http";
import { submitProposal } from "@/lib/planning/mutations";
import {
  parseNullablePositiveId,
  parsePositiveId,
  parseReason,
  parseRequestId,
  parseRevision,
  parseSlot,
} from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const body = await readObjectBody(req);
  const periodId = parsePositiveId(body.periodId, "対象四半期ID");
  const revision = parseRevision(body.revision);
  const chosenSlot = parseSlot(body.chosenSlot ?? body.recommendedSlot ?? body.slot);
  const reason = parseReason(body.reason);
  const requestId = parseRequestId(body.requestId);
  const reviewerKey = ["reviewerUserId", "reviewerId", "reviewer_user_id"].find((key) =>
    Object.prototype.hasOwnProperty.call(body, key),
  );
  const reviewerUserId = reviewerKey
    ? parseNullablePositiveId(body[reviewerKey], "レビュー担当")
    : undefined;
  const result = await submitProposal({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    revision,
    chosenSlot,
    reason,
    reviewerUserId,
    requestId,
  });
  if (!result.idempotent) {
    await audit(uid, "portfolio_plan.proposal_submit", {
      entity: "portfolio_plan_proposal",
      entityId: result.id,
      summary: `v${result.version}:${chosenSlot === 0 ? "A案" : "B案"}`,
    });
  }
  return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
});
