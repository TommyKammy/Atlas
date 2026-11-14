import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { getTaskProjectId, requireProjectPermission } from "@/lib/api-project-auth";
import { insertTask, afterTaskCreated } from "@/lib/services/task-create";
import { withUser } from "@/lib/api/route";

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { project_id, section_id, name, parent_task_id, start_on, due_on, assignee_id } = body;
  let isMilestone = false;
  if (body.is_milestone !== undefined) {
    if (typeof body.is_milestone !== "boolean") {
      return NextResponse.json({ error: "is_milestone must be a boolean" }, { status: 400 });
    }
    isMilestone = body.is_milestone;
  }
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (project_id === null || project_id === undefined || project_id === "") {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  const projectId = Number(project_id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "invalid project_id" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let sectionId: number | null = null;
  if (section_id !== null && section_id !== undefined && section_id !== "") {
    sectionId = Number(section_id);
    const section = await db.query("SELECT project_id FROM sections WHERE id = $1::bigint", [sectionId]);
    if (section.rowCount === 0 || Number(section.rows[0].project_id) !== projectId) {
      return NextResponse.json({ error: "section does not belong to project" }, { status: 400 });
    }
  }
  let parentId: number | null = null;
  if (parent_task_id !== null && parent_task_id !== undefined && parent_task_id !== "") {
    parentId = Number(parent_task_id);
    const parentProjectId = await getTaskProjectId(parentId);
    if (parentProjectId !== projectId) {
      return NextResponse.json({ error: "parent task is in another project" }, { status: 400 });
    }
  }
  let assigneeId: number | null = null;
  if (assignee_id !== null && assignee_id !== undefined && assignee_id !== "") {
    assigneeId = Number(assignee_id);
    const user = await db.query("SELECT id FROM users WHERE id = $1 AND deactivated_at IS NULL", [assigneeId]);
    if (user.rowCount === 0) {
      return NextResponse.json({ error: "assignee not found" }, { status: 400 });
    }
  }
  if (isMilestone && parentId !== null) {
    return NextResponse.json({ error: "milestone cannot be a subtask" }, { status: 400 });
  }
  const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const start = dateOrNull(start_on);
  const due = dateOrNull(due_on);
  const id = await withTransaction(q => insertTask(q, {
    projectId, sectionId, parentId, name: name.trim(), start, due, assigneeId, uid, isMilestone,
  }));
  await afterTaskCreated(projectId, id, uid, name);
  const stamp = await db.query("SELECT updated_at::text AS updated_at FROM tasks WHERE id = $1", [id]);
  return NextResponse.json({ id, updated_at: stamp.rows[0].updated_at }, { status: 201 });
});
