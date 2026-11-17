import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { parsePortfolioId, readObjectBody, requireWorkspaceId } from "@/lib/planning/http";
import { decideProposal } from "@/lib/planning/mutations";
import {
  parseDecisionReason,
  parseExpectedProposalStatus,
  parsePositiveId,
  parseProposalDecisionAction,
  parseRequestId,
} from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const proposalId = parsePositiveId(params.proposalId, "投資提案ID");
  const body = await readObjectBody(req);
  const action = parseProposalDecisionAction(body.action ?? body.outcome);
  const reason = parseDecisionReason(body.reason ?? body.note ?? body.comment);
  const requestId = parseRequestId(body.requestId);
  const expectedStatus = parseExpectedProposalStatus(
    body.expectedStatus ?? body.expected_status ?? body.currentStatus,
  );
  const result = await decideProposal({
    workspaceId,
    portfolioId,
    userId: uid,
    proposalId,
    action,
    reason,
    requestId,
    expectedStatus,
  });
  return NextResponse.json(result);
});
