import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { badRequest, notFound } from "@/lib/api/errors";
import {
  createRuleEditorDraft,
  getRuleEditorDraft,
  getRuleEditorSource,
  listRuleEditorDrafts,
} from "@/lib/automation/editor-drafts";

export const GET = withProject("edit", async (req, { uid, projectId }) => {
  const rawRuleId = new URL(req.url).searchParams.get("rule_id");
  if (rawRuleId === null) return NextResponse.json({ drafts: await listRuleEditorDrafts(projectId, uid) });
  const ruleId = Number(rawRuleId);
  if (!Number.isSafeInteger(ruleId) || ruleId <= 0) throw badRequest("invalid rule_id");
  const rule = await getRuleEditorSource(projectId, uid, ruleId);
  if (!rule) throw notFound("rule not found");
  return NextResponse.json({ rule, draft: await getRuleEditorDraft(projectId, uid, { ruleId }) });
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { rule_id?: unknown };
  if (typeof payload !== "object" || Array.isArray(payload)) throw badRequest("invalid draft");
  if (payload.rule_id !== undefined &&
      (typeof payload.rule_id !== "number" || !Number.isSafeInteger(payload.rule_id) || payload.rule_id <= 0)) {
    throw badRequest("invalid rule_id");
  }
  const result = await createRuleEditorDraft(projectId, uid, payload.rule_id as number | undefined);
  return NextResponse.json({ draft: result.draft }, { status: result.created ? 201 : 200 });
}, { body: true });
