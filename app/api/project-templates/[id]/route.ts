import { NextResponse } from "next/server";
import { todayISO } from "@/lib/dates";
import { shiftDate } from "@/lib/timeline-dnd";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { requireActiveUser, requireWorkspaceAdmin } from "@/lib/api-project-auth";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireWorkspaceAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const { id } = await params;
  const r = await db.query("DELETE FROM project_templates WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: Number(id) });
}

// Instantiate a template into a new project. Body: { name: string }.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const active = await requireActiveUser(req);
  if (!active.ok) return NextResponse.json({ error: active.error }, { status: active.status });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const t = await db.query("SELECT workspace_id, payload FROM project_templates WHERE id = $1::bigint", [id]);
  if (t.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const payload = t.rows[0].payload as { sections?: { name: string; tasks?: { name: string; description?: string; assignee_id?: number | null; due_offset_days?: number | null; status?: string }[] }[] };
  const sections = Array.isArray(payload?.sections) ? payload.sections.slice(0, 50) : [];
  const p = await db.query("INSERT INTO projects (workspace_id, name) VALUES ($1, $2) RETURNING id", [
    t.rows[0].workspace_id,
    name,
  ]);
  const projectId = p.rows[0].id as number;
  for (const [si, s] of sections.entries()) {
    if (typeof s?.name !== "string" || s.name.trim() === "") continue;
    const sec = await db.query("INSERT INTO sections (project_id, name, position) VALUES ($1, $2, $3) RETURNING id", [
      projectId,
      s.name.trim().slice(0, 255),
      (si + 1) * 1000,
    ]);
    const sectionId = sec.rows[0].id as number;
    const tasks = Array.isArray(s.tasks) ? s.tasks.slice(0, 200) : [];
    for (const [ti, task] of tasks.entries()) {
      if (typeof task?.name !== "string" || task.name.trim() === "") continue;
      const due =
        typeof task.due_offset_days === "number" && Number.isFinite(task.due_offset_days)
          ? shiftDate(todayISO(), task.due_offset_days)
          : null;
      await db.query(
        `INSERT INTO tasks (project_id, section_id, parent_task_id, name, description, assignee_id,
           due_on, progress, status, position)
         VALUES ($1, $2, NULL, $3, $4, $5, $6::date, 0, $7, ${(ti + 1) * 1000})`,
        [
          projectId,
          sectionId,
          task.name.trim().slice(0, 255),
          typeof task.description === "string" ? task.description : "",
          typeof task.assignee_id === "number" ? task.assignee_id : null,
          due,
          typeof task.status === "string" && task.status !== "" ? task.status.slice(0, 64) : "inbox",
        ],
      );
    }
  }
  await notifyProject(projectId);
  return NextResponse.json({ id: projectId }, { status: 201 });
}
