import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { withResourceProject } from "@/lib/api/route";
import type { FormField } from "@/lib/forms";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

function dateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

export const POST = withResourceProject("view", "project_forms", async (_req, { uid, params, body }) => {
  const id = params.id;
  const formResult = await db.query(
    `SELECT f.*, p.status_options, p.status_field_enabled
     FROM project_forms f JOIN projects p ON p.id = f.project_id
     WHERE f.id = $1::bigint`,
    [id],
  );
  if (formResult.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const form = formResult.rows[0] as {
    project_id: number;
    name: string;
    fields: FormField[];
    published: boolean;
    created_by: number | null;
    status_options: string[] | null;
    status_field_enabled: boolean;
  };
  if (!form.published) return NextResponse.json({ error: "form is not published" }, { status: 403 });
  const answers = (body as { answers?: unknown } | null)?.answers;
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return NextResponse.json({ error: "answers are required" }, { status: 400 });
  }
  const values = answers as Record<string, unknown>;
  const fields = form.fields;
  const cleaned: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.key];
    const value = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : String(raw).trim();
    if (field.required && value === "") {
      return NextResponse.json({ error: `${field.label} is required` }, { status: 400 });
    }
    if (value === "") continue;
    if (field.type === "select" && field.options.length > 0 && !field.options.includes(value)) {
      return NextResponse.json({ error: `${field.label} has an invalid option` }, { status: 400 });
    }
    if (field.type === "date" && dateValue(value) === null) {
      return NextResponse.json({ error: `${field.label} has an invalid date` }, { status: 400 });
    }
    if (field.type === "number" && Number.isNaN(Number(value))) {
      return NextResponse.json({ error: `${field.label} must be a number` }, { status: 400 });
    }
    cleaned[field.key] = value;
  }
  const title = (cleaned.title || "フォーム回答").slice(0, 255);
  const dueOn = cleaned.due_on && dateValue(cleaned.due_on) ? cleaned.due_on : null;
  const detailLines = fields
    .filter((field) => field.key !== "title" && cleaned[field.key])
    .map((field) => `- ${field.label}: ${cleaned[field.key]}`);
  const description = [`フォーム「${form.name}」から作成`, ...detailLines].join("\n");

  const section = await db.query(
    "SELECT id FROM sections WHERE project_id = $1 ORDER BY position, id LIMIT 1",
    [form.project_id],
  );
  const sectionId = section.rows[0]?.id ?? null;
  const status =
    form.status_field_enabled !== false && Array.isArray(form.status_options) && form.status_options.length > 0
      ? form.status_options[0]
      : "inbox";
  const taskId = await withTransaction(async (q) => {
    const position = await q.query(
      `SELECT COALESCE(MAX(position), 0) + 1000 AS position
       FROM tasks WHERE project_id = $1 AND parent_task_id IS NULL`,
      [form.project_id],
    );
    const task = await q.query(
      `INSERT INTO tasks (project_id, section_id, name, description, due_on, status, position, created_by)
       VALUES ($1::bigint, $2::bigint, $3, $4, $5::date, $6, $7, $8) RETURNING id`,
      [
        form.project_id,
        sectionId,
        title,
        description,
        dueOn,
        status,
        Number(position.rows[0].position),
        form.created_by,
      ],
    );
    const insertedId = Number(task.rows[0].id);
    await q.query(
      `INSERT INTO form_responses (form_id, task_id, answers, submitted_by)
       VALUES ($1::bigint, $2::bigint, $3::jsonb, $4)`,
      [id, insertedId, JSON.stringify(cleaned), uid],
    );
    return insertedId;
  });
  await notifyProject(Number(form.project_id));
  await audit(uid, "form.submit", {
    entity: "form",
    entityId: Number(id),
    projectId: Number(form.project_id),
    summary: `task ${taskId}`,
  });
  return NextResponse.json({ ok: true, task_id: taskId, project_id: Number(form.project_id) }, { status: 201 });
}, { body: true });
