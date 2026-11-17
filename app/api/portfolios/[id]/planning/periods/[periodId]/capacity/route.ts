import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { saveCapacities } from "@/lib/planning/mutations";
import {
  parseCapacityInputs,
  parsePositiveId,
  parseRevision,
} from "@/lib/planning/validation";

export const PUT = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const periodId = parsePositiveId(params.periodId, "対象四半期ID");
  const body = await readObjectBody(req);
  const revision = parseRevision(body.revision);
  const capacities = parseCapacityInputs(body.capacities);
  const result = await saveCapacities({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    revision,
    capacities,
  });
  return NextResponse.json(result);
});
