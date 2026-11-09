import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject, notifyTask } from "@/lib/notify";
import { requireTaskPermission } from "@/lib/api-project-auth";
import { withProject } from "@/lib/api/route";
import { emitTaskEvent } from "@/lib/domain/events";

// Extra project memberships (multi-homing). The primary project stored on
// tasks.project_id cannot be removed through this endpoint.
export const POST = withProject("edit", async (req, { uid, projectId, body }) => {
  const { task_id, section_id } = (body ?? {}) as { task_id?: number; section_id?: number | null };
  if (!task_id) {
    return NextResponse.json({ error: "task_id and project_id are required" }, { status: 400 });
  }
  const t = await db.query("SELECT project_id FROM tasks WHERE id = $1::bigint", [task_id]);
  if (t.rowCount === 0) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (Number(t.rows[0].project_id) === projectId) {
    return NextResponse.json({ error: "already the primary project" }, { status: 400 });
  }
  const sourceAuth = await requireTaskPermission(req, Number(task_id), "edit");
  if (!sourceAuth.ok) return NextResponse.json({ error: sourceAuth.error }, { status: sourceAuth.status });
  await db.query(
    `INSERT INTO task_project_memberships (task_id, project_id, section_id)
     VALUES ($1::bigint, $2::bigint, $3::bigint)
     ON CONFLICT (task_id, project_id) DO UPDATE SET section_id = EXCLUDED.section_id`,
    [task_id, projectId, section_id ?? null],
  );
  await notifyProject(projectId);
  await notifyTask(task_id);
  await emitTaskEvent({
    projectId,
    taskId: Number(task_id),
    actorId: uid,
    type: "task.added_to_project",
    data: { project_id: projectId, section_id: section_id ?? null },
  }).catch(() => undefined);
  return NextResponse.json({ ok: true }, { status: 201 });
}, { body: true });

export const DELETE = withProject("edit", async (req, { projectId }) => {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("task_id");
  if (!taskId) {
    return NextResponse.json({ error: "task_id and project_id are required" }, { status: 400 });
  }
  const sourceAuth = await requireTaskPermission(req, Number(taskId), "edit");
  if (!sourceAuth.ok) return NextResponse.json({ error: sourceAuth.error }, { status: sourceAuth.status });
  await db.query(
    "DELETE FROM task_project_memberships WHERE task_id = $1::bigint AND project_id = $2::bigint",
    [taskId, projectId],
  );
  await notifyProject(projectId);
  await notifyTask(taskId);
  return NextResponse.json({ ok: true });
});
