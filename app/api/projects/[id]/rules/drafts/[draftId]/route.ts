import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { notFound } from "@/lib/api/errors";
import { deleteRuleEditorDraft, getRuleEditorDraft, saveRuleEditorDraft } from "@/lib/automation/editor-drafts";

export const GET = withProject("edit", async (_req, { uid, projectId, params }) => {
  const draft = await getRuleEditorDraft(projectId, uid, { draftId: params.draftId });
  if (!draft) throw notFound("draft not found");
  return NextResponse.json({ draft });
});

export const PUT = withProject("edit", async (_req, { uid, projectId, params, body }) => {
  const payload = body as { expected_revision?: unknown } | null;
  const draft = await saveRuleEditorDraft(projectId, uid, params.draftId, payload?.expected_revision, body);
  return NextResponse.json({ draft });
}, { body: true });

export const DELETE = withProject("edit", async (_req, { uid, projectId, params, body }) => {
  const payload = body as { expected_revision?: unknown } | null;
  await deleteRuleEditorDraft(projectId, uid, params.draftId, payload?.expected_revision);
  return new NextResponse(null, { status: 204 });
}, { body: true });
