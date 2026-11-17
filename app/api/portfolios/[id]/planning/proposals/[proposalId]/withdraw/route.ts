import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { parsePortfolioId, readObjectBody, requireWorkspaceId } from "@/lib/planning/http";
import { withdrawProposal } from "@/lib/planning/mutations";
import {
  parseExpectedProposalStatus,
  parsePositiveId,
  parseRequestId,
  parseWithdrawReason,
} from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const proposalId = parsePositiveId(params.proposalId, "投資提案ID");
  const body = await readObjectBody(req);
  const reason = parseWithdrawReason(body.reason ?? body.note ?? body.comment);
  const requestId = parseRequestId(body.requestId);
  const expectedStatus = parseExpectedProposalStatus(
    body.expectedStatus ?? body.expected_status ?? body.currentStatus,
  );
  const result = await withdrawProposal({
    workspaceId,
    portfolioId,
    userId: uid,
    proposalId,
    reason,
    requestId,
    expectedStatus,
  });
  return NextResponse.json(result);
});
