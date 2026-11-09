import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withTask } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { logEvent } from "@/lib/repositories/tasks";
import { notifyProject } from "@/lib/notify";
import { emitTaskEvent } from "@/lib/domain/events";

/** Duplicate one task (fields + custom-field values) into the same project/section. */
export const POST = withTask("edit", async (_req, { taskId, uid, projectId }) => {
  if (!projectId) return NextResponse.json({ error: "task has no project" }, { status: 400 });
  const source = await db.query(
    `SELECT project_id, section_id, parent_task_id, name, description, description_doc,
       assignee_id, start_on::text AS start_on, due_on::text AS due_on,
       progress, status, recurrence
     FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL`,
    [taskId],
  );
  if (source.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const t = source.rows[0] as {
    project_id: number;
    section_id: number | null;
    parent_task_id: number | null;
    name: string;
    description: string;
    description_doc: unknown;
    assignee_id: number | null;
    start_on: string | null;
    due_on: string | null;
    progress: number;
    status: string;
    recurrence: string;
  };
  const inserted = await db.query(
    `INSERT INTO tasks (
       project_id, section_id, parent_task_id, name, description, description_doc,
       assignee_id, created_by, completed, start_on, due_on, progress, status, recurrence, position
     ) VALUES (
       $1::bigint, $2::bigint, $3::bigint, $4, $5, $6::jsonb,
       $7::bigint, $8::bigint, FALSE, $9::date, $10::date, $11, $12, $13,
       COALESCE((SELECT MAX(position) FROM tasks
         WHERE project_id = $1::bigint AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1)
           AND COALESCE(parent_task_id,-1) = COALESCE($3::bigint,-1)), 0) + 1000
     ) RETURNING id`,
    [
      t.project_id,
      t.section_id,
      t.parent_task_id,
      t.name,
      t.description,
      t.description_doc === null || t.description_doc === undefined
        ? null
        : JSON.stringify(t.description_doc),
      t.assignee_id,
      uid,
      t.start_on,
      t.due_on,
      t.progress ?? 0,
      t.status ?? "inbox",
      t.recurrence ?? "none",
    ],
  );
  const newId = Number(inserted.rows[0].id);
  await db.query(
    `INSERT INTO task_custom_values
       (task_id, field_id, value_text, value_number, value_date, value_json)
     SELECT $1::bigint, field_id, value_text, value_number, value_date, value_json
     FROM task_custom_values WHERE task_id = $2::bigint
     ON CONFLICT (task_id, field_id) DO NOTHING`,
    [newId, taskId],
  );
  await logEvent(newId, uid, "created", "タスクを複製しました").catch(() => undefined);
  await audit(uid, "task.duplicate", {
    entity: "task",
    entityId: newId,
    projectId,
    summary: `from ${taskId}`,
  });
  await notifyProject(projectId);
  await emitTaskEvent({
    projectId,
    taskId: newId,
    actorId: uid,
    type: "task.created",
    data: { duplicated_from: taskId },
  }).catch(() => undefined);
  return NextResponse.json({ id: newId }, { status: 201 });
});
