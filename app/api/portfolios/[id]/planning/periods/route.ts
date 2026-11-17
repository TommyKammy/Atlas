import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { parsePortfolioId, readObjectBody, requireWorkspaceId } from "@/lib/planning/http";
import { createPlanningPeriod } from "@/lib/planning/mutations";
import {
  parseBudgetYen,
  parseQuarter,
  parseRoleNames,
  parseYear,
} from "@/lib/planning/validation";

export const POST = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const body = await readObjectBody(req);
  const year = parseYear(body.year);
  const quarter = parseQuarter(body.quarter);
  const budgetYen = parseBudgetYen(body.budgetYen);
  const roleNames = parseRoleNames(body.roles);
  const result = await createPlanningPeriod({
    workspaceId,
    portfolioId,
    userId: uid,
    year,
    quarter,
    budgetYen,
    roleNames,
  });
  return NextResponse.json(result, { status: 201 });
});
