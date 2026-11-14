import { db } from "../db";
import { getProjectPolicyAccess } from "../project-policy-access";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, assertEdit, asString, finishTaskAction, taskProject } from "./shared";

export async function taskSetStatus(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const taskId = actionTaskId(params, ctx.event);
  if (!taskId) throw new Error("task.set_status requires a task");
  const projectId = await taskProject(taskId, q);
  await assertEdit(ctx, projectId);
  if (!(await getProjectPolicyAccess(ctx.actorId, projectId, q)).canConfigure) throw new Error("project configuration is restricted");
  const status = asString(params.status).slice(0, 64);
  if (status === "") throw new Error("status is required");
  const changed = await q.query(
    "UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2::bigint AND status IS DISTINCT FROM $1",
    [status, taskId],
  );
  if (changed.rowCount === 0) return { summary: "Statusは変更されていません", data: { status } };
  return finishTaskAction(ctx, taskId, "task.status_changed", { status }, `Statusを${status}に変更しました`);
}
