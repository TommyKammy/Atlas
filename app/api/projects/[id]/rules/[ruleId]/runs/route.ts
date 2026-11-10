import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { getManualRuleExecution, getProjectRule, getRuleRuns } from "@/lib/automation/repository";

export const GET = withProject("view", async (req, { projectId, params }) => {
  const id = Number(params.ruleId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid rule id" }, { status: 400 });
  }
  if (!(await getProjectRule(id, projectId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const eventId = url.searchParams.has("event_id") ? Number(url.searchParams.get("event_id")) : undefined;
  if (eventId !== undefined && (!Number.isSafeInteger(eventId) || eventId <= 0)) {
    return NextResponse.json({ error: "invalid event id" }, { status: 400 });
  }
  const execution = eventId === undefined ? undefined : await getManualRuleExecution(projectId, id, eventId);
  if (execution === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    runs: await getRuleRuns(projectId, id, Number.isFinite(limit) ? Math.trunc(limit) : 50, eventId),
    ...(execution ? { execution } : {}),
  });
});
