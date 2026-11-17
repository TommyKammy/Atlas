import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
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
  await audit(uid, "portfolio_plan.scenario_update", {
    entity: "portfolio_plan_period",
    entityId: periodId,
    summary: slot === 0 ? "A案" : "B案",
  });
  return NextResponse.json(result);
});
