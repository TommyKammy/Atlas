import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { createInitiative } from "@/lib/planning/mutations";
import {
  parseDemandInputs,
  parseInitiativeKind,
  parseName,
  parseNullableCostYen,
  parseOptionalProjectId,
  parsePositiveId,
  parseRevision,
} from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const body = await readObjectBody(req);
  const periodId = parsePositiveId(body.periodId, "対象四半期ID");
  const revision = parseRevision(body.revision);
  const result = await createInitiative({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    revision,
    name: parseName(body.name, "案件名", 160),
    ownerName: parseName(body.ownerName, "起案責任者", 120),
    expectedEffect: parseName(body.expectedEffect, "期待効果", 1000),
    kind: parseInitiativeKind(body.kind),
    linkedProjectId: parseOptionalProjectId(body.linkedProjectId),
    costYen: parseNullableCostYen(body.costYen),
    demands: parseDemandInputs(body.demands),
  });
  await audit(uid, "portfolio_plan.initiative_create", {
    entity: "portfolio_initiative",
    entityId: result.id,
    summary: String(body.name),
  });
  return NextResponse.json(result, { status: 201 });
});
