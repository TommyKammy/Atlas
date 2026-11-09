import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { suggestRuleDefinition } from "@/lib/automation/ai";

export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, body }) => {
    const payload = (body ?? {}) as { prompt?: unknown };
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (prompt === "") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    try {
      return NextResponse.json(await suggestRuleDefinition(projectId, uid, prompt.slice(0, 1000)));
    } catch (caught) {
      return NextResponse.json(
        { error: caught instanceof Error ? caught.message : "suggestion failed" },
        { status: 400 },
      );
    }
  },
  { body: true },
);
