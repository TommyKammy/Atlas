import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { publishRuleEditorDraft } from "@/lib/automation/editor-drafts";

export const POST = withProject("configure", async (_req, { uid, projectId, params, body }) => {
  const payload = body as { expected_revision?: unknown } | null;
  return NextResponse.json(await publishRuleEditorDraft(projectId, uid, params.draftId, payload?.expected_revision));
}, { body: true });
