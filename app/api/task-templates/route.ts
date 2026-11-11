import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";

export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    `SELECT t.id, t.name, t.title_template, t.description, t.assignee_id,
       u.name AS assignee_name, t.due_offset_days, t.section_id, s.name AS section_name, t.subtasks
     FROM task_templates t
     LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN sections s ON s.id = t.section_id
     WHERE t.project_id = $1::bigint ORDER BY t.id`,
    [projectId],
  );
  return NextResponse.json(r.rows);
});

export const POST = withProject("configure", async (_req, { uid, projectId, body }) => {
  const { name, title_template, description, assignee_id, due_offset_days, section_id, subtasks } = (body ?? {}) as {
    name?: string;
    title_template?: string;
    description?: string;
    assignee_id?: number | null;
    due_offset_days?: number | null;
    section_id?: number | null;
    subtasks?: unknown;
  };
  if (!name || String(name).trim() === "" || !title_template || String(title_template).trim() === "") {
    return NextResponse.json({ error: "project_id, name and title_template are required" }, { status: 400 });
  }
  const subs = Array.isArray(subtasks)
    ? subtasks
        .filter((x) => typeof x === "object" && x !== null && typeof x.name === "string" && x.name.trim() !== "")
        .slice(0, 50)
        .map((x: { name: string }) => ({ name: x.name.trim().slice(0, 255) }))
    : [];
  const r = await db.query(
    `INSERT INTO task_templates (project_id, name, title_template, description, assignee_id,
       due_offset_days, section_id, subtasks, created_by)
     VALUES ($1::bigint, $2, $3, $4, $5::bigint, $6::int, $7::bigint, $8::jsonb, $9)
     RETURNING id`,
    [
      projectId,
      String(name).trim(),
      String(title_template).trim(),
      typeof description === "string" ? description : "",
      assignee_id ?? null,
      due_offset_days ?? null,
      section_id ?? null,
      JSON.stringify(subs),
      uid,
    ],
  );
  await notifyProject(projectId);
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
