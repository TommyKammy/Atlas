import { audit } from "../audit";
import { db } from "../db";
import { assertOrdinaryTaskMutation } from "../services/task-approval-guard";
import { recordTaskCompletion, TASK_COMPLETION_COLUMNS } from "../services/task-completion";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, assertEdit, taskProject } from "./shared";

export async function taskComplete(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const taskId = actionTaskId(params, ctx.event);
  if (!taskId) throw new Error("task.complete requires a task");
  const projectId = await taskProject(taskId, q);
  await assertEdit(ctx, projectId);
  await assertOrdinaryTaskMutation(q, [taskId], { completed: true });
  const changed = await q.query(
    `UPDATE tasks SET completed = TRUE, completed_at = now(), updated_at = now()
     WHERE id = $1::bigint AND project_id = $2::bigint AND deleted_at IS NULL AND NOT completed
     RETURNING ${TASK_COMPLETION_COLUMNS}`,
    [taskId, projectId],
  );
  if (changed.rowCount) {
    await recordTaskCompletion(q, {
      task: changed.rows[0],
      projectId,
      actorId: ctx.actorId,
      data: { completed: true },
      causationId: ctx.eventId ?? null,
      automationRuleId: ctx.ruleId ?? null,
      chainDepth: ctx.chainDepth + 1,
      correlationId: ctx.correlationId ?? null,
    });
    await audit(ctx.actorId, "automation.task.completed", {
      entity: "task",
      entityId: taskId,
      projectId,
      summary: "タスクを完了しました",
    }, q);
    ctx.notifyAfterCommit?.(projectId);
  }
  return { summary: "タスクを完了しました", data: { completed: true } };
}
