import { audit } from "../audit";
import { db } from "../db";
import { emitDomainEvent } from "../domain/events";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, asNumber, assertEdit, taskProject } from "./shared";

export async function taskAddToProject(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const taskId = actionTaskId(params, ctx.event);
  const targetProjectId = asNumber(params.project_id);
  if (!taskId || !targetProjectId) throw new Error("task.add_to_project requires task and project");
  const sourceProjectId = await taskProject(taskId, q);
  await assertEdit(ctx, sourceProjectId);
  await assertEdit(ctx, targetProjectId);
  const primary = await q.query("SELECT project_id FROM tasks WHERE id = $1::bigint", [taskId]);
  if (Number(primary.rows[0]?.project_id) === targetProjectId) {
    return { summary: "タスクはすでにプロジェクトに所属しています", data: { project_id: targetProjectId } };
  }
  const added = await q.query(
    `INSERT INTO task_project_memberships (task_id, project_id, section_id)
     VALUES ($1::bigint, $2::bigint, NULL)
     ON CONFLICT (task_id, project_id) DO NOTHING`,
    [taskId, targetProjectId],
  );
  if (added.rowCount === 0) {
    return { summary: "タスクはすでにプロジェクトに所属しています", data: { project_id: targetProjectId } };
  }
  await audit(ctx.actorId, "automation.task.add_to_project", {
    entity: "task",
    entityId: taskId,
    projectId: targetProjectId,
    summary: `task ${taskId}`,
  }, q);
  ctx.notifyAfterCommit?.(targetProjectId);
  const targetWorkspace = await q.query(
    "SELECT workspace_id FROM projects WHERE id = $1::bigint",
    [targetProjectId],
  );
  if (targetWorkspace.rows[0]?.workspace_id) {
    await emitDomainEvent({
      workspaceId: Number(targetWorkspace.rows[0].workspace_id),
      projectId: targetProjectId,
      actorId: ctx.actorId,
      type: "task.added_to_project",
      subjectType: "task",
      subjectId: taskId,
      data: { project_id: targetProjectId },
      causationId: ctx.eventId ?? null,
      automationRuleId: ctx.ruleId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    }, q);
  }
  return { summary: "タスクを別プロジェクトに追加しました", data: { project_id: targetProjectId } };
}
