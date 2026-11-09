import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { getPortfolio, getPortfolioRuleRuns } from "@/lib/repositories/portfolios";

export const GET = withUser(async (req, { uid, params }) => {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const portfolioId = Number(params.id);
  const portfolio = Number.isInteger(portfolioId)
    ? await getPortfolio(portfolioId, ws.id, uid)
    : null;
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ruleId = Number(params.ruleId);
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  return NextResponse.json({
    runs: await getPortfolioRuleRuns(
      portfolioId,
      uid,
      Number.isInteger(ruleId) && ruleId > 0 ? ruleId : undefined,
      Number.isFinite(limit) ? limit : 50,
    ),
  });
});
