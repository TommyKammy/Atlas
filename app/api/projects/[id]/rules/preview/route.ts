import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { withTransaction } from "@/lib/db";
import { getProjectPolicyAccess } from "@/lib/project-policy-access";
import { validateRuleDefinition } from "@/lib/automation/validate";
import { validateRuleConditionScope } from "@/lib/automation/condition-validation";
import { validateRuleCustomFieldActions } from "@/lib/automation/custom-field-actions";
import { configuredTaskId } from "@/lib/automation/task-target";
import { previewEvent } from "@/lib/automation/preview-event";
import { previewResponse } from "@/lib/automation/preview";
import { loadRuleSnapshot } from "@/lib/automation/snapshot";
import { evaluateRule } from "@/lib/automation/evaluation";

export const POST = withProject("configure", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { rule_id?: unknown; definition?: unknown; event?: unknown };
  if ((JSON.stringify(payload.definition)?.length ?? 0) > 131_072) return NextResponse.json({ error: "definition is too large" }, { status: 400 });
  const ruleId = payload.rule_id === undefined ? undefined : configuredTaskId(payload.rule_id);
  if (ruleId === null) return NextResponse.json({ error: "invalid rule_id" }, { status: 400 });
  const definition = validateRuleDefinition(payload.definition);
  if (!definition.ok) return NextResponse.json({ error: definition.error }, { status: 400 });
  return withTransaction(async (q) => {
    await q.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (!(await getProjectPolicyAccess(uid, projectId, q)).canConfigure) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const project = await q.query("SELECT workspace_id FROM projects WHERE id = $1 AND deleted_at IS NULL", [projectId]);
    if (project.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    let disabled = false;
    if (ruleId !== undefined) {
      const rule = await q.query("SELECT owner_id, enabled FROM project_rules WHERE id = $1 AND project_id = $2 AND portfolio_rule_id IS NULL", [ruleId, projectId]);
      if (rule.rowCount === 0) return NextResponse.json({ error: "rule not found" }, { status: 404 });
      if (Number(rule.rows[0].owner_id) !== uid) return NextResponse.json({ error: "only the rule owner can preview its draft" }, { status: 403 });
      disabled = rule.rows[0].enabled !== true;
    }
    const event = previewEvent(payload.event, { projectId, workspaceId: Number(project.rows[0].workspace_id), actorId: uid });
    if (!event.ok) return NextResponse.json({ error: event.error }, { status: 400 });
    const conditions = await validateRuleConditionScope(definition.definition, { projectId }, uid, q);
    if (!conditions.ok) return NextResponse.json({ error: conditions.error }, { status: 400 });
    const custom = await validateRuleCustomFieldActions(definition.definition, uid, q);
    if (!custom.ok) return NextResponse.json({ error: custom.error }, { status: custom.status });
    const snapshot = await loadRuleSnapshot(event.event, q, true);
    if (!snapshot) return NextResponse.json({ error: "task not found in this project" }, { status: 404 });
    const evaluation = evaluateRule(definition.definition, snapshot, ruleId);
    return NextResponse.json(previewResponse(evaluation.trace, evaluation.actions, [
      ...event.warnings,
      ...(disabled ? ["保存済みルールは現在無効です。テストでは編集している定義のみを評価しました。"] : []),
    ]));
  });
}, { body: true });
