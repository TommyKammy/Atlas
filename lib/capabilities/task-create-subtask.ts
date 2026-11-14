import { audit } from "../audit";
import { todayISO } from "../dates";
import { db } from "../db";
import { emitTaskEvent } from "../domain/events";
import { logEvent } from "../repositories/tasks";
import { shiftDate } from "../timeline-dnd";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, asNumber, assertEdit, asString } from "./shared";

export async function taskCreateSubtask(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const parentId = actionTaskId(params, ctx.event);
  if (!parentId) throw new Error("task.create_subtask requires a parent task");
  const parent = await q.query(
    `SELECT project_id, section_id, parent_task_id FROM tasks
     WHERE id = $1::bigint AND deleted_at IS NULL`,
    [parentId],
  );
  if (parent.rowCount === 0) throw new Error("parent task not found");
  const projectId = Number(parent.rows[0].project_id);
  await assertEdit(ctx, projectId);
  const name = asString(params.name);
  if (name === "") throw new Error("subtask name is required");
  const assignee = asNumber(params.assignee_id);
  let due: string | null = null;
  const offset = Number(params.due_offset_days);
  if (Number.isFinite(offset)) due = shiftDate(todayISO(), Math.trunc(offset));
  const inserted = await q.query(
    `INSERT INTO tasks (
       project_id, section_id, parent_task_id, name, assignee_id, due_on, created_by,
       position
     ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5::bigint, $6::date, $7::bigint,
       COALESCE((SELECT MAX(position) FROM tasks WHERE parent_task_id = $3::bigint), 0) + 1000)
     RETURNING id`,
    [
      projectId,
      parent.rows[0].section_id ?? null,
      parentId,
      name.slice(0, 255),
      assignee,
      due,
      ctx.actorId,
    ],
  );
  const taskId = Number(inserted.rows[0].id);
  await logEvent(taskId, ctx.actorId, "created", "サブタスクをルールから作成しました", q);
  await audit(ctx.actorId, "automation.task.create_subtask", {
    entity: "task",
    entityId: taskId,
    projectId,
    summary: name,
  }, q);
  ctx.notifyAfterCommit?.(projectId);
  await emitTaskEvent({
    projectId,
    taskId,
    actorId: ctx.actorId,
    type: "task.created",
    data: { parent_task_id: parentId, created_by_rule: true },
    causationId: ctx.eventId ?? null,
    automationRuleId: ctx.ruleId ?? null,
    chainDepth: ctx.chainDepth + 1,
    correlationId: ctx.correlationId ?? null,
  }, q);
  return { summary: "サブタスクを作成しました", data: { task_id: taskId } };
}
