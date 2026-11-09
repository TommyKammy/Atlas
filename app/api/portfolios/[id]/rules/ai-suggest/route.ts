import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { getPortfolio, getPortfolioProjects } from "@/lib/repositories/portfolios";
import { suggestPortfolioRuleDefinition } from "@/lib/automation/ai";

export const POST = withUser(async (req, { uid, params }) => {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const id = Number(params.id);
  const portfolio = Number.isInteger(id) ? await getPortfolio(id, ws.id, uid) : null;
  if (!portfolio) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!portfolio.can_edit) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const projects = await getPortfolioProjects(id);
  if (projects.length === 0) {
    return NextResponse.json({ error: "portfolio has no projects" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt === "") return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  try {
    return NextResponse.json(
      await suggestPortfolioRuleDefinition(id, uid, prompt.slice(0, 1000), projects[0].id),
    );
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "suggestion failed" },
      { status: 400 },
    );
  }
});
