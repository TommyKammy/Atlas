import { db } from "../db";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, asNumber, assertEdit, finishTaskAction, taskProject } from "./shared";

export async function taskAssign(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const taskId = actionTaskId(params, ctx.event);
  if (!taskId) throw new Error("task.assign requires a task");
  const projectId = await taskProject(taskId, q);
  await assertEdit(ctx, projectId);
  const userId = asNumber(params.user_id);
  if (userId !== null) {
    const user = await q.query(
      "SELECT id FROM users WHERE id = $1::bigint AND deactivated_at IS NULL",
      [userId],
    );
    if (user.rowCount === 0) throw new Error("assignee not found");
  }
  const changed = await q.query(
    `UPDATE tasks SET assignee_id = $1::bigint, updated_at = now()
     WHERE id = $2::bigint AND assignee_id IS DISTINCT FROM $1::bigint`,
    [userId, taskId],
  );
  if (changed.rowCount === 0) return { summary: "担当者は変更されていません", data: { assignee_id: userId } };
  return finishTaskAction(ctx, taskId, "task.assigned", { assignee_id: userId }, "担当者を変更しました");
}
