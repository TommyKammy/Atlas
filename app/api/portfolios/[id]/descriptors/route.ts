import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { getPortfolio } from "@/lib/repositories/portfolios";
import { getPortfolioRuleDescriptors } from "@/lib/automation/descriptors";

export const GET = withUser(async (_req, { uid, params }) => {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const id = Number(params.id);
  const portfolio = Number.isInteger(id) ? await getPortfolio(id, ws.id, uid) : null;
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });
  const descriptors = await getPortfolioRuleDescriptors(id, uid);
  if (!descriptors) {
    return NextResponse.json(
      { error: "portfolio has no projects" },
      { status: 400 },
    );
  }
  return NextResponse.json(descriptors);
});
