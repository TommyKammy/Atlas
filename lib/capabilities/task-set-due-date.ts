import { todayISO } from "../dates";
import { db } from "../db";
import { shiftDate } from "../timeline-dnd";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, assertEdit, asString, finishTaskAction, taskProject } from "./shared";

export async function taskSetDueDate(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const taskId = actionTaskId(params, ctx.event);
  if (!taskId) throw new Error("task.set_due_date requires a task");
  const projectId = await taskProject(taskId, q);
  await assertEdit(ctx, projectId);
  let due = asString(params.due_on);
  if (due === "") {
    const offset = Number(params.offset_days);
    if (Number.isFinite(offset)) due = shiftDate(todayISO(), Math.trunc(offset));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("valid due_on or offset_days is required");
  const current = await q.query(
    "SELECT start_on::text AS start_on FROM tasks WHERE id = $1::bigint",
    [taskId],
  );
  const start = current.rows[0]?.start_on as string | null | undefined;
  if (start && start > due) throw new Error("due date cannot be before start date");
  const changed = await q.query(
    `UPDATE tasks SET due_on = $1::date, updated_at = now()
     WHERE id = $2::bigint AND due_on IS DISTINCT FROM $1::date`,
    [due, taskId],
  );
  if (changed.rowCount === 0) return { summary: "期日は変更されていません", data: { due_on: due } };
  return finishTaskAction(ctx, taskId, "task.due_changed", { due_on: due }, `期日を${due}に変更しました`);
}
