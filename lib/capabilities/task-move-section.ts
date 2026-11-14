import { db } from "../db";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, asNumber, assertEdit, finishTaskAction } from "./shared";

export async function taskMoveSection(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const taskId = actionTaskId(params, ctx.event);
  if (!taskId) throw new Error("task.move_section requires a task");
  const task = await q.query(
    "SELECT project_id, section_id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
    [taskId],
  );
  const primaryProjectId = task.rows[0]?.project_id;
  if (!primaryProjectId) throw new Error("task not found or has no project");
  const taskEvent = ctx.event?.subject_type === "task";
  const projectId = taskEvent ? ctx.projectId : Number(primaryProjectId);
  if (ctx.event && ctx.event.project_id !== ctx.projectId) throw new Error("invalid source project");
  if (ctx.event && !taskEvent) await assertEdit(ctx, ctx.projectId);
  await assertEdit(ctx, projectId);
  const sectionId = asNumber(params.section_id);
  if (!sectionId) throw new Error("section_id is required");
  const section = await q.query(
    "SELECT project_id FROM sections WHERE id = $1::bigint FOR KEY SHARE",
    [sectionId],
  );
  if (section.rowCount === 0 || Number(section.rows[0].project_id) !== projectId) {
    throw new Error("section does not belong to the task project");
  }
  let previousSection: number | null = task.rows[0].section_id;
  const secondary = Number(primaryProjectId) !== projectId;
  if (secondary) {
    const membership = await q.query(
      `SELECT section_id FROM task_project_memberships
       WHERE task_id = $1::bigint AND project_id = $2::bigint FOR UPDATE`,
      [taskId, projectId],
    );
    if (membership.rowCount === 0) throw new Error("source project task membership not found");
    previousSection = membership.rows[0].section_id;
  }
  if (previousSection === sectionId) {
    return { summary: "セクションは変更されていません", data: { project_id: projectId, section_id: sectionId, unchanged: true } };
  }
  if (secondary) {
    await q.query(
      `UPDATE task_project_memberships SET section_id = $3::bigint
       WHERE task_id = $1::bigint AND project_id = $2::bigint`,
      [taskId, projectId, sectionId],
    );
    // The normal task editor uses this shared version for secondary placement too.
    await q.query("UPDATE tasks SET updated_at = now() WHERE id = $1::bigint", [taskId]);
  } else {
    await q.query(
      "UPDATE tasks SET section_id = $1::bigint, updated_at = now() WHERE id = $2::bigint",
      [sectionId, taskId],
    );
  }
  await q.query(
    "DELETE FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = $2::bigint",
    [taskId, projectId],
  );
  return finishTaskAction(
    ctx,
    taskId,
    "task.section_changed",
    { project_id: projectId, previous_section_id: previousSection, section_id: sectionId },
    "セクションを変更しました",
    projectId,
  );
}
