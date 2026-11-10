import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { parseRuleOptionQuery } from "@/lib/automation/no-code-inputs";
import { searchRuleOptions } from "@/lib/automation/options";

export const GET = withProject("edit", async (req, { uid, projectId }) => {
  const query = parseRuleOptionQuery(new URL(req.url).searchParams);
  if (!query.ok) return NextResponse.json({ error: query.error }, { status: 400 });
  const result = await searchRuleOptions(projectId, uid, query.value);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ options: result.options, hasMore: result.hasMore });
});
