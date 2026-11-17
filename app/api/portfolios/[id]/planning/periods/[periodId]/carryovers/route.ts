import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { attachInitiativeToPeriod } from "@/lib/planning/mutations";
import { parsePositiveId, parseRevision } from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const periodId = parsePositiveId(params.periodId, "対象四半期ID");
  const body = await readObjectBody(req);
  const revision = parseRevision(body.revision);
  const initiativeId = parsePositiveId(body.initiativeId, "案件ID");
  const result = await attachInitiativeToPeriod({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    initiativeId,
    revision,
  });
  return NextResponse.json(result);
});
