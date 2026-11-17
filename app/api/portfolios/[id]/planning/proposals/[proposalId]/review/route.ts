import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { parsePortfolioId, readObjectBody, requireWorkspaceId } from "@/lib/planning/http";
import { reviewProposal } from "@/lib/planning/mutations";
import {
  parseExpectedProposalStatus,
  parsePositiveId,
  parseProposalReviewAction,
  parseProposalReviewNote,
  parseRequestId,
} from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const proposalId = parsePositiveId(params.proposalId, "投資提案ID");
  const body = await readObjectBody(req);
  const action = parseProposalReviewAction(body.action ?? body.outcome);
  const note = parseProposalReviewNote(body.note ?? body.comment ?? body.reason);
  const requestId =
    body.requestId === undefined || body.requestId === null
      ? null
      : parseRequestId(body.requestId);
  const expectedStatus = parseExpectedProposalStatus(
    body.expectedStatus ?? body.expected_status ?? body.currentStatus,
  );
  const result = await reviewProposal({
    workspaceId,
    portfolioId,
    userId: uid,
    proposalId,
    action,
    note,
    requestId,
    expectedStatus,
  });
  if (!result.idempotent) {
    await audit(uid, "portfolio_plan.proposal_review", {
      entity: "portfolio_plan_proposal",
      entityId: result.id,
      summary: `v${result.version}:${result.outcome}`,
    });
  }
  return NextResponse.json(result);
});
