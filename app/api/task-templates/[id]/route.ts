import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { shiftDate } from "@/lib/timeline-dnd";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyProject } from "@/lib/notify";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await db.query("SELECT project_id FROM task_templates WHERE id = $1::bigint", [id]);
  const r = await db.query("DELETE FROM task_templates WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(owner.rows[0]?.project_id ?? null);
  return NextResponse.json({ deleted: Number(id) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const t = await db.query(
    `SELECT project_id, title_template, description, assignee_id, due_offset_days,
       section_id, subtasks FROM task_templates WHERE id = $1::bigint`,
    [id],
  );
  if (t.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const tpl = t.rows[0] as {
    project_id: number;
    title_template: string;
    description: string;
    assignee_id: number | null;
    due_offset_days: number | null;
    section_id: number | null;
    subtasks: { name: string }[];
  };
  const overrideSection =
    body && Number.isInteger((body as Record<string, unknown>).section_id)
      ? Number((body as Record<string, unknown>).section_id)
      : tpl.section_id;
  const due =
    tpl.due_offset_days === null
      ? null
      : shiftDate(todayISO(), tpl.due_offset_days);
  const created = await db.query(
    `INSERT INTO tasks (project_id, section_id, parent_task_id, name, description, assignee_id,
       due_on, progress, status, position)
     VALUES ($1, $2, NULL, $3, $4, $5, $6::date, 0, 'inbox',
       COALESCE((SELECT MAX(position) FROM tasks
                 WHERE COALESCE(project_id,-1) = COALESCE($1::bigint,-1)
                   AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1)
                   AND parent_task_id IS NULL), 0) + 1000)
     RETURNING id`,
    [tpl.project_id, overrideSection, tpl.title_template, tpl.description, tpl.assignee_id, due],
  );
  const taskId = created.rows[0].id as number;
  const subs = Array.isArray(tpl.subtasks) ? tpl.subtasks : [];
  for (const [i, st] of subs.entries()) {
    if (typeof st?.name !== "string" || st.name.trim() === "") continue;
    await db.query(
      `INSERT INTO tasks (project_id, section_id, parent_task_id, name, position)
       VALUES ($1, $2, $3, $4, ${(i + 1) * 1000})`,
      [tpl.project_id, overrideSection, taskId, st.name.trim().slice(0, 255)],
    );
  }
  await logEvent(taskId, uid, "created", "タスクをテンプレートから作成しました").catch(() => undefined);
  await notifyProject(tpl.project_id);
  return NextResponse.json({ id: taskId }, { status: 201 });
}
