import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { saveScenarioSelection } from "@/lib/planning/mutations";
import {
  parseIdList,
  parsePositiveId,
  parseRevision,
  parseSlot,
} from "@/lib/planning/validation";

export const PUT = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const periodId = parsePositiveId(params.periodId, "対象四半期ID");
  const slot = parseSlot(params.slot);
  const body = await readObjectBody(req);
  const revision = parseRevision(body.revision);
  const initiativeIds = parseIdList(body.initiativeIds);
  const result = await saveScenarioSelection({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    slot,
    revision,
    initiativeIds,
  });
  return NextResponse.json(result);
});
