import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { notifyProject, notifyTask } from "@/lib/notify";
import { getTaskProjectContext, requireTaskPermission } from "@/lib/api-project-auth";
import { withProject } from "@/lib/api/route";
import { emitTaskEvent } from "@/lib/domain/events";

// Extra project memberships (multi-homing). The primary project stored on
// tasks.project_id cannot be removed through this endpoint.
export const POST = withProject("edit", async (req, { uid, projectId, body }) => {
  const { task_id, section_id } = (body ?? {}) as { task_id?: unknown; section_id?: unknown };
  const taskId = Number(task_id);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) throw badRequest("invalid task_id");
  const sectionId = section_id == null ? null : Number(section_id);
  if (sectionId !== null && (!Number.isSafeInteger(sectionId) || sectionId <= 0)) {
    throw badRequest("invalid section_id");
  }
  const sourceAuth = await requireTaskPermission(req, taskId, "edit");
  if (!sourceAuth.ok) return NextResponse.json({ error: sourceAuth.error }, { status: sourceAuth.status });
  await withTransaction(async (q) => {
    // Serialize membership writes with promotion to the task's primary home.
    const task = await q.query(
      "SELECT project_id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
      [taskId],
    );
    if (task.rowCount === 0) throw notFound("task not found");
    if (task.rows[0].project_id === projectId) throw badRequest("already the primary project");
    if (sourceAuth.projectId !== null && sourceAuth.projectId !== task.rows[0].project_id) {
      const context = await getTaskProjectContext(taskId, q);
      if (!context?.projectIds.includes(sourceAuth.projectId)) throw conflict("task membership changed");
    }
    if (sectionId !== null) {
      const section = await q.query(
        "SELECT id FROM sections WHERE id = $1::bigint AND project_id = $2::bigint FOR KEY SHARE",
        [sectionId, projectId],
      );
      if (section.rowCount === 0) throw badRequest("section does not belong to project");
    }
    const membership = await q.query(
      "SELECT section_id FROM task_project_memberships WHERE task_id = $1::bigint AND project_id = $2::bigint FOR UPDATE",
      [taskId, projectId],
    );
    await q.query(
      `INSERT INTO task_project_memberships (task_id, project_id, section_id)
       VALUES ($1::bigint, $2::bigint, $3::bigint)
       ON CONFLICT (task_id, project_id) DO UPDATE SET section_id = EXCLUDED.section_id`,
      [taskId, projectId, sectionId],
    );
    const previousMembership = membership.rows[0];
    if (!previousMembership || previousMembership.section_id !== sectionId) {
      await q.query(
        "DELETE FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = $2::bigint",
        [taskId, projectId],
      );
      await emitTaskEvent({
        projectId,
        taskId,
        actorId: uid,
        type: previousMembership ? "task.section_changed" : "task.added_to_project",
        data: { project_id: projectId, previous_section_id: previousMembership?.section_id ?? null, section_id: sectionId },
      }, q);
    }
  });
  await notifyProject(projectId);
  await notifyTask(taskId);
  return NextResponse.json({ ok: true }, { status: 201 });
}, { body: true });

export const DELETE = withProject("edit", async (req, { projectId }) => {
  const { searchParams } = new URL(req.url);
  const taskId = Number(searchParams.get("task_id"));
  if (!Number.isSafeInteger(taskId) || taskId <= 0) throw badRequest("invalid task_id");
  const sourceAuth = await requireTaskPermission(req, taskId, "edit");
  if (!sourceAuth.ok) return NextResponse.json({ error: sourceAuth.error }, { status: sourceAuth.status });
  await withTransaction(async (q) => {
    const task = await q.query("SELECT project_id FROM tasks WHERE id = $1::bigint FOR UPDATE", [taskId]);
    if (!task.rows[0]) throw notFound("task not found");
    await q.query(
      "DELETE FROM task_project_memberships WHERE task_id = $1::bigint AND project_id = $2::bigint",
      [taskId, projectId],
    );
    if (task.rows[0].project_id !== projectId) {
      await q.query(
        "DELETE FROM task_timeline_rows WHERE task_id = $1::bigint AND project_id = $2::bigint",
        [taskId, projectId],
      );
    }
  });
  await notifyProject(projectId);
  await notifyTask(taskId);
  return NextResponse.json({ ok: true });
});
