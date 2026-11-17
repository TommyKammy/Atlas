import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { saveRoleEdits } from "@/lib/planning/mutations";
import {
  parsePositiveId,
  parseRevision,
  parseRoleEdits,
} from "@/lib/planning/validation";

export const PUT = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const body = await readObjectBody(req);
  const periodId = parsePositiveId(body.periodId, "対象四半期ID");
  const revision = parseRevision(body.revision);
  const roles = parseRoleEdits(body.roles);
  const result = await saveRoleEdits({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    revision,
    roles,
  });
  await audit(uid, "portfolio_plan.roles_update", {
    entity: "portfolio",
    entityId: portfolioId,
  });
  return NextResponse.json(result);
});
