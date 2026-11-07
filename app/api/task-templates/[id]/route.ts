import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { shiftDate } from "@/lib/timeline-dnd";
import { notifyProject } from "@/lib/notify";
import { withResourceProject } from "@/lib/api/route";


export const PATCH = withResourceProject("edit", "task_templates", async (_req, { projectId, params, body }) => {
  const id = params.id;
  const patch = (body ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof patch.name === "string" && patch.name.trim() !== "") {
    values.push(patch.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (typeof patch.title_template === "string" && patch.title_template.trim() !== "") {
    values.push(patch.title_template.trim());
    sets.push(`title_template = $${values.length}`);
  }
  if (typeof patch.description === "string") {
    values.push(patch.description);
    sets.push(`description = $${values.length}`);
  }
  if ("assignee_id" in patch) {
    values.push(patch.assignee_id === null || patch.assignee_id === "" ? null : Number(patch.assignee_id));
    sets.push(`assignee_id = $${values.length}::bigint`);
  }
  if ("due_offset_days" in patch) {
    values.push(patch.due_offset_days === null || patch.due_offset_days === "" ? null : Number(patch.due_offset_days));
    sets.push(`due_offset_days = $${values.length}::int`);
  }
  if ("section_id" in patch) {
    values.push(patch.section_id === null || patch.section_id === "" ? null : Number(patch.section_id));
    sets.push(`section_id = $${values.length}::bigint`);
  }
  if (Array.isArray(patch.subtasks)) {
    const subs = patch.subtasks
      .filter((x: unknown) => typeof x === "object" && x !== null && typeof (x as { name?: unknown }).name === "string" && String((x as { name: string }).name).trim() !== "")
      .slice(0, 50)
      .map((x: { name: string }) => ({ name: x.name.trim().slice(0, 255) }));
    values.push(JSON.stringify(subs));
    sets.push(`subtasks = $${values.length}::jsonb`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(id);
  await db.query(`UPDATE task_templates SET ${sets.join(", ")} WHERE id = $${values.length}::bigint`, values);
  await notifyProject(projectId);
  return NextResponse.json({ id: Number(id) });
}, { body: true });

export const DELETE = withResourceProject("edit", "task_templates", async (_req, { projectId, params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM task_templates WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(projectId);
  return NextResponse.json({ deleted: Number(id) });
});

export const POST = withResourceProject("edit", "task_templates", async (_req, { uid, projectId, params, body }) => {
  const id = params.id;
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
    [projectId, overrideSection, tpl.title_template, tpl.description, tpl.assignee_id, due],
  );
  const taskId = created.rows[0].id as number;
  const subs = Array.isArray(tpl.subtasks) ? tpl.subtasks : [];
  for (const [i, st] of subs.entries()) {
    if (typeof st?.name !== "string" || st.name.trim() === "") continue;
    await db.query(
      `INSERT INTO tasks (project_id, section_id, parent_task_id, name, position)
       VALUES ($1, $2, $3, $4, ${(i + 1) * 1000})`,
      [projectId, overrideSection, taskId, st.name.trim().slice(0, 255)],
    );
  }
  await logEvent(taskId, uid, "created", "タスクをテンプレートから作成しました").catch(() => undefined);
  await notifyProject(projectId);
  return NextResponse.json({ id: taskId }, { status: 201 });
}, { body: true });
