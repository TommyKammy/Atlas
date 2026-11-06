import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject, notifyTask } from "@/lib/notify";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";

// Extra project memberships (multi-homing). The primary project stored on
// tasks.project_id cannot be removed through this endpoint.
export async function POST(req: Request) {
  const body = await req.json();
  const { task_id, project_id, section_id } = body;
  if (!task_id || !project_id) {
    return NextResponse.json({ error: "task_id and project_id are required" }, { status: 400 });
  }
  const targetAuth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!targetAuth.ok) return NextResponse.json({ error: targetAuth.error }, { status: targetAuth.status });
  const t = await db.query("SELECT project_id FROM tasks WHERE id = $1::bigint", [task_id]);
  if (t.rowCount === 0) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (Number(t.rows[0].project_id) === Number(project_id)) {
    return NextResponse.json({ error: "already the primary project" }, { status: 400 });
  }
  const sourceProjectId = await getTaskProjectId(Number(task_id));
  if (sourceProjectId !== null) {
    const sourceAuth = await requireProjectPermission(req, sourceProjectId, "view");
    if (!sourceAuth.ok) return NextResponse.json({ error: sourceAuth.error }, { status: sourceAuth.status });
  }
  await db.query(
    `INSERT INTO task_project_memberships (task_id, project_id, section_id)
     VALUES ($1::bigint, $2::bigint, $3::bigint)
     ON CONFLICT (task_id, project_id) DO UPDATE SET section_id = EXCLUDED.section_id`,
    [task_id, project_id, section_id ?? null],
  );
  await notifyProject(project_id);
  await notifyTask(task_id);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("task_id");
  const projectId = searchParams.get("project_id");
  if (!taskId || !projectId) {
    return NextResponse.json({ error: "task_id and project_id are required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, Number(projectId), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await db.query(
    "DELETE FROM task_project_memberships WHERE task_id = $1::bigint AND project_id = $2::bigint",
    [taskId, projectId],
  );
  await notifyProject(projectId);
  await notifyTask(taskId);
  return NextResponse.json({ ok: true });
}
