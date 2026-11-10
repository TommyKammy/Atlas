import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { db } from "@/lib/db";
import { emitDomainEvent } from "@/lib/domain/events";
import { processAutomationEvent } from "@/lib/automation/engine";
import { getManualRuleExecution, getProjectRule } from "@/lib/automation/repository";

/** Manually trigger one rule against a task (Asana-style manual trigger). */
export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, params, body }) => {
    const ruleId = Number(params.ruleId);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      return NextResponse.json({ error: "invalid rule id" }, { status: 400 });
    }
    const rule = await getProjectRule(ruleId, projectId);
    if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!rule.enabled || !rule.definition.triggers.some((trigger) => trigger.event === "task.manual_rule")) {
      return NextResponse.json({ error: "有効な手動実行ルールを指定してください" }, { status: 409 });
    }
    const payload = (body ?? {}) as { task_id?: unknown };
    const taskId = Number(payload.task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return NextResponse.json({ error: "task_id is required" }, { status: 400 });
    }
    const task = await db.query(
      `SELECT t.id FROM tasks t
       WHERE t.id = $1::bigint AND t.deleted_at IS NULL
         AND (t.project_id = $2::bigint OR EXISTS (
           SELECT 1 FROM task_project_memberships m
           WHERE m.task_id = t.id AND m.project_id = $2::bigint
         ))`,
      [taskId, projectId],
    );
    if (task.rowCount === 0) return NextResponse.json({ error: "task not found" }, { status: 404 });
    const eventId = await emitDomainEvent({
      workspaceId: rule.workspace_id,
      projectId,
      subjectType: "task",
      subjectId: taskId,
      actorId: uid,
      type: "task.manual_rule",
      data: { target_rule_id: ruleId, manual: true },
      correlationId: `manual:${ruleId}:${taskId}:${Date.now()}`,
    });
    await processAutomationEvent(eventId);
    const execution = await getManualRuleExecution(projectId, ruleId, eventId);
    return NextResponse.json(execution, { status: execution?.status === "queued" ? 202 : 201 });
  },
  { body: true },
);
