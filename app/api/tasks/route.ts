import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { requireProjectPermission } from "@/lib/api-project-auth";

export async function POST(req: Request) {
  const body = await req.json();
  const { project_id, section_id, name, parent_task_id, start_on, due_on, assignee_id } = body;
  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (project_id !== null && project_id !== undefined) {
    const auth = await requireProjectPermission(req, Number(project_id), "edit");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const start = dateOrNull(start_on);
  const due = dateOrNull(due_on);
  const uid = getCurrentUserIdFromRequest(req);
  const r = await db.query(
    `INSERT INTO tasks (project_id, section_id, parent_task_id, name, position, start_on, due_on, assignee_id, created_by)
     VALUES ($1, $2, $3, $4,
       COALESCE((SELECT MAX(position) FROM tasks
                 WHERE COALESCE(project_id,-1) = COALESCE($1::bigint,-1)
                   AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1)
                   AND COALESCE(parent_task_id,-1) = COALESCE($3::bigint,-1)), 0) + 1000,
       $5, $6, $7, $8)
     RETURNING id`,
    [project_id ?? null, section_id ?? null, parent_task_id ?? null, name.trim(), start, due,
     typeof assignee_id === "number" ? assignee_id : null, uid],
  );
  const id = r.rows[0].id as number;
  await notifyProject(project_id ?? null);
  await audit(uid, "task.create", { entity: "task", entityId: id, projectId: project_id ?? null, summary: name });
  await logEvent(id, uid, "created", "タスクを作成しました").catch(() => undefined);
  return NextResponse.json({ id }, { status: 201 });
}
