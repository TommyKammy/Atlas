import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/api/errors";
import { logEvent } from "@/lib/repositories/tasks";
import { notifyProject } from "@/lib/notify";
import { emitTaskEvent } from "@/lib/domain/events";

type CopyContext = { taskId: number; uid: number; projectId: number | null };

function nextPositionSql(): string {
  return `COALESCE((SELECT MAX(position) FROM tasks
    WHERE project_id = $1::bigint AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1)
      AND COALESCE(parent_task_id,-1) = COALESCE($3::bigint,-1)), 0) + 1000`;
}

async function afterCreate(
  newId: number,
  taskId: number,
  uid: number,
  projectId: number,
  event: { type: "task.created"; data: Record<string, number> },
  auditAction: string,
  eventSummary: string,
): Promise<void> {
  await logEvent(newId, uid, "created", eventSummary).catch(() => undefined);
  await audit(uid, auditAction, {
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
    ...event,
  }).catch(() => undefined);
}

/** Duplicate one task (fields + custom-field values) into the same project/section. */
export async function duplicateTask({
  taskId,
  uid,
  projectId,
}: CopyContext): Promise<{ id: number }> {
  if (!projectId) throw badRequest("task has no project");
  const source = await db.query(
    `SELECT project_id, section_id, parent_task_id, name, description, description_doc,
       assignee_id, start_on::text AS start_on, due_on::text AS due_on,
       progress, status, recurrence, is_milestone
     FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL`,
    [taskId],
  );
  if (source.rowCount === 0) throw notFound();
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
    is_milestone: boolean;
  };
  const inserted = await db.query(
    `INSERT INTO tasks (
       project_id, section_id, parent_task_id, name, description, description_doc,
       assignee_id, created_by, completed, start_on, due_on, progress, status, recurrence,
       is_milestone, position
     ) VALUES (
       $1::bigint, $2::bigint, $3::bigint, $4, $5, $6::jsonb,
       $7::bigint, $8::bigint, FALSE, $9::date, $10::date, $11, $12, $13,
       $14, ${nextPositionSql()}
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
      t.is_milestone === true,
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
  await afterCreate(
    newId,
    taskId,
    uid,
    projectId,
    { type: "task.created", data: { duplicated_from: taskId } },
    "task.duplicate",
    "タスクを複製しました",
  );
  return { id: newId };
}

/** Create a follow-up task in the same project/section. */
export async function createFollowUpTask({
  taskId,
  uid,
  projectId,
}: CopyContext): Promise<{ id: number }> {
  if (!projectId) throw badRequest("task has no project");
  const source = await db.query(
    `SELECT project_id, section_id, parent_task_id, name, assignee_id
     FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL`,
    [taskId],
  );
  if (source.rowCount === 0) throw notFound();
  const t = source.rows[0] as {
    project_id: number;
    section_id: number | null;
    parent_task_id: number | null;
    name: string;
    assignee_id: number | null;
  };
  const name = `フォローアップ: ${t.name}`.slice(0, 255);
  const inserted = await db.query(
    `INSERT INTO tasks (
       project_id, section_id, parent_task_id, name, description, assignee_id,
       created_by, completed, progress, status, position
     ) VALUES (
       $1::bigint, $2::bigint, $3::bigint, $4, $5, $6::bigint,
       $7::bigint, FALSE, 0, 'inbox',
       ${nextPositionSql()}
     ) RETURNING id`,
    [
      t.project_id,
      t.section_id,
      t.parent_task_id,
      name,
      `元タスク: ${t.name}`,
      t.assignee_id,
      uid,
    ],
  );
  const newId = Number(inserted.rows[0].id);
  await afterCreate(
    newId,
    taskId,
    uid,
    projectId,
    { type: "task.created", data: { follow_up_of: taskId } },
    "task.follow_up",
    "フォローアップタスクを作成しました",
  );
  return { id: newId };
}
