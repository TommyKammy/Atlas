import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { from?: unknown; subject?: unknown; body?: unknown };
  const from = typeof payload.from === "string" ? payload.from.trim().slice(0, 200) : "";
  const subject = typeof payload.subject === "string" ? payload.subject.trim().slice(0, 255) : "";
  const text = typeof payload.body === "string" ? payload.body.trim().slice(0, 10000) : "";
  if (subject === "") return NextResponse.json({ error: "subject is required" }, { status: 400 });
  const project = await db.query(
    `SELECT email_enabled, status_options, status_field_enabled,
       (SELECT id FROM sections WHERE project_id = $1 ORDER BY position, id LIMIT 1) AS section_id
     FROM projects WHERE id = $1::bigint`,
    [projectId],
  );
  if (project.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (project.rows[0].email_enabled === false) {
    return NextResponse.json({ error: "email intake is disabled" }, { status: 403 });
  }
  const status =
    project.rows[0].status_field_enabled !== false &&
    Array.isArray(project.rows[0].status_options) &&
    project.rows[0].status_options.length > 0
      ? project.rows[0].status_options[0]
      : "inbox";
  const description = [
    from ? `メール送信者: ${from}` : "",
    text,
  ]
    .filter(Boolean)
    .join("\n\n");
  const taskId = await withTransaction(async (q) => {
    const position = await q.query(
      `SELECT COALESCE(MAX(position), 0) + 1000 AS position
       FROM tasks WHERE project_id = $1 AND parent_task_id IS NULL`,
      [projectId],
    );
    const task = await q.query(
      `INSERT INTO tasks (project_id, section_id, name, description, status, position, created_by)
       VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6, $7) RETURNING id`,
      [
        projectId,
        project.rows[0].section_id ?? null,
        subject,
        description,
        status,
        Number(position.rows[0].position),
        uid,
      ],
    );
    const inserted = Number(task.rows[0].id);
    await q.query(
      `INSERT INTO project_email_messages (project_id, from_address, subject, body, task_id)
       VALUES ($1::bigint, $2, $3, $4, $5::bigint)`,
      [projectId, from, subject, text, inserted],
    );
    return inserted;
  });
  await notifyProject(projectId);
  await audit(uid, "project_email.intake", {
    entity: "task",
    entityId: taskId,
    projectId,
  });
  return NextResponse.json({ ok: true, task_id: taskId }, { status: 201 });
}, { body: true });
