import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { parsePortfolioId, requireWorkspaceId } from "@/lib/planning/http";
import { loadPlanningState } from "@/lib/planning/repository";
import { parsePeriodKeyInput } from "@/lib/planning/validation";

export const GET = withUser(async (req, { uid, params }) => {
  const workspaceId = await requireWorkspaceId();
  const portfolioId = parsePortfolioId(params.id);
  const url = new URL(req.url);
  const periodKey = parsePeriodKeyInput(url.searchParams.get("period"));
  const state = await loadPlanningState({
    portfolioId,
    workspaceId,
    userId: uid,
    periodKey: periodKey ? `${periodKey.year}-Q${periodKey.quarter}` : null,
  });
  return NextResponse.json(state);
});
