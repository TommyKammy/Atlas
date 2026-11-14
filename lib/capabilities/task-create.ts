import { audit } from "../audit";
import { todayISO } from "../dates";
import { db } from "../db";
import { emitTaskEvent } from "../domain/events";
import { logEvent } from "../repositories/tasks";
import { shiftDate } from "../timeline-dnd";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { asNumber, assertEdit, asString } from "./shared";

export async function taskCreate(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const projectId = asNumber(params.project_id ?? ctx.projectId);
  if (!projectId) throw new Error("task.create requires a project");
  await assertEdit(ctx, projectId);
  const name = asString(params.name);
  if (name === "") throw new Error("task name is required");
  let sectionId: number | null = null;
  if (params.section_id !== undefined && params.section_id !== null && params.section_id !== "") {
    sectionId = asNumber(params.section_id);
    if (!sectionId) throw new Error("invalid section_id");
    const section = await q.query(
      "SELECT project_id FROM sections WHERE id = $1::bigint",
      [sectionId],
    );
    if (section.rowCount === 0 || Number(section.rows[0].project_id) !== projectId) {
      throw new Error("section does not belong to the project");
    }
  }
  const assignee = asNumber(params.assignee_id);
  let due: string | null = null;
  const offset = Number(params.due_offset_days);
  if (Number.isFinite(offset)) due = shiftDate(todayISO(), Math.trunc(offset));
  const inserted = await q.query(
    `INSERT INTO tasks (
       project_id, section_id, parent_task_id, name, assignee_id, due_on, created_by,
       status, position
     ) VALUES ($1::bigint, $2::bigint, NULL, $3, $4::bigint, $5::date, $6::bigint,
       'inbox',
       COALESCE((SELECT MAX(position) FROM tasks
                 WHERE project_id = $1::bigint AND parent_task_id IS NULL), 0) + 1000)
     RETURNING id`,
    [projectId, sectionId, name.slice(0, 255), assignee, due, ctx.actorId],
  );
  const taskId = Number(inserted.rows[0].id);
  await logEvent(taskId, ctx.actorId, "created", "タスクをルールから作成しました", q);
  await audit(ctx.actorId, "automation.task.create", {
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
    data: { created_by_rule: true },
    causationId: ctx.eventId ?? null,
    automationRuleId: ctx.ruleId ?? null,
    chainDepth: ctx.chainDepth + 1,
    correlationId: ctx.correlationId ?? null,
  }, q);
  return { summary: "タスクを作成しました", data: { task_id: taskId } };
}
