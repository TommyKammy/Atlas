import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { getRuleRuns } from "@/lib/automation/repository";

export const GET = withProject("view", async (req, { projectId, params }) => {
  const id = Number(params.ruleId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid rule id" }, { status: 400 });
  }
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  return NextResponse.json({
    runs: await getRuleRuns(projectId, id, Number.isFinite(limit) ? limit : 50),
  });
});
