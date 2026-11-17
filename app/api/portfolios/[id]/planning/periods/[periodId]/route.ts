import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import {
  parsePortfolioId,
  readObjectBody,
  requireWorkspaceId,
} from "@/lib/planning/http";
import { updatePeriodBudget } from "@/lib/planning/mutations";
import {
  parseBudgetYen,
  parsePositiveId,
  parseRevision,
} from "@/lib/planning/validation";

export const PATCH = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const periodId = parsePositiveId(params.periodId, "対象四半期ID");
  const body = await readObjectBody(req);
  const revision = parseRevision(body.revision);
  const budgetYen = parseBudgetYen(body.budgetYen);
  const result = await updatePeriodBudget({
    workspaceId,
    portfolioId,
    userId: uid,
    periodId,
    revision,
    budgetYen,
  });
  await audit(uid, "portfolio_plan.budget_update", {
    entity: "portfolio_plan_period",
    entityId: periodId,
    summary: `${budgetYen}円`,
  });
  return NextResponse.json(result);
});
