import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { adoptScenario } from "@/lib/planning/mutations";
import {
  parsePositiveId,
  parseReason,
  parseRequestId,
  parseRevision,
  parseSlot,
} from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const periodId = parsePositiveId(params.periodId, "対象四半期ID");
  const body = await readObjectBody(req);
  const revision = parseRevision(body.revision);
  const chosenSlot = parseSlot(body.chosenSlot);
  const reason = parseReason(body.reason);
  const requestId = parseRequestId(body.requestId);
  const result = await adoptScenario({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    revision,
    chosenSlot,
    reason,
    requestId,
  });
  return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
});
