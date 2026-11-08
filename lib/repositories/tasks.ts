import { db } from "../db";
import type { Attachment, TaskRow } from "../data";
import type { CustomValue } from "../custom-fields";
import { projectTaskScope } from "./scope";
import { TASK_FROM, TASK_SELECT_COLS, toTaskRow } from "./task-select";

export async function getProjectTasks(projectId: number): Promise<TaskRow[]> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS},
       COALESCE(m.section_id, t.section_id) AS eff_section_id
     ${TASK_FROM}
     LEFT JOIN task_project_memberships m ON m.task_id = t.id AND m.project_id = $1
     WHERE t.parent_task_id IS NULL AND t.deleted_at IS NULL
       AND (t.project_id = $1 OR m.task_id IS NOT NULL)
     ORDER BY t.position, t.id`,
    [projectId],
  );
  return r.rows.map(toTaskRow);
}

export async function getTask(taskId: number) {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS} ${TASK_FROM} WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [taskId],
  );
  return r.rows[0] ? toTaskRow(r.rows[0] as TaskRow) : undefined;
}

/** Task scoped to a project the caller can already see (primary, multi-home, or subtask). */
export async function getTaskForProject(taskId: number, projectId: number) {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS}
     ${TASK_FROM}
     WHERE t.id = $1 AND t.deleted_at IS NULL
       AND (
         t.project_id = $2
         OR EXISTS (
           SELECT 1 FROM task_project_memberships m
           WHERE m.task_id = t.id AND m.project_id = $2
         )
         OR EXISTS (
           SELECT 1 FROM tasks parent
           WHERE parent.id = t.parent_task_id
             AND (
               parent.project_id = $2
               OR EXISTS (
                 SELECT 1 FROM task_project_memberships pm
                 WHERE pm.task_id = parent.id AND pm.project_id = $2
               )
             )
         )
       )`,
    [taskId, projectId],
  );
  return r.rows[0] ? toTaskRow(r.rows[0] as TaskRow) : undefined;
}

export async function getSubtasks(taskId: number): Promise<TaskRow[]> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS} ${TASK_FROM}
     WHERE t.parent_task_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.position, t.id`,
    [taskId],
  );
  return r.rows.map(toTaskRow);
}

export async function getMyTasks(userId: number): Promise<(TaskRow & { project_name: string | null })[]> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS}
     ${TASK_FROM}
     LEFT JOIN my_task_orders o ON o.task_id = t.id AND o.user_id = $1
     WHERE t.assignee_id = $1 AND t.completed = FALSE
       AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
     ORDER BY o.position NULLS LAST, t.due_on NULLS LAST, t.position, t.id`,
    [userId],
  );
  return r.rows.map((row) => ({ ...toTaskRow(row as TaskRow), project_name: row.project_name ?? null }));
}

export async function getDependencies(taskId: number) {
  const r = await db.query(
    "SELECT t.id, t.name FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = $1 ORDER BY t.id",
    [taskId],
  );
  return r.rows as { id: number; name: string }[];
}

export async function getProjectTaskOptions(projectId: number) {
  const r = await db.query(
    `SELECT t.id, t.name FROM tasks t
     WHERE ${projectTaskScope("t")} AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
     ORDER BY t.position, t.id`,
    [projectId],
  );
  return r.rows as { id: number; name: string }[];
}

export type TaskEventRow = {
  id: number;
  summary: string;
  actor_name: string | null;
  created_at: string;
};

export async function getTaskEvents(taskId: number): Promise<TaskEventRow[]> {
  const r = await db.query(
    `SELECT e.id, e.summary, u.name AS actor_name, e.created_at::text
     FROM task_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.task_id = $1 ORDER BY e.created_at DESC LIMIT 50`,
    [taskId],
  );
  return r.rows;
}

export async function getSubtasksBulk(projectId: number): Promise<Record<number, TaskRow[]>> {
  const r = await db.query(
    `SELECT ${TASK_SELECT_COLS}
     ${TASK_FROM}
     WHERE t.parent_task_id IS NOT NULL AND t.deleted_at IS NULL
       AND (
         t.project_id = $1
         OR EXISTS (
           SELECT 1 FROM tasks p
           JOIN task_project_memberships m ON m.task_id = p.id AND m.project_id = $1
           WHERE p.id = t.parent_task_id
         )
       )
     ORDER BY t.position, t.id`,
    [projectId],
  );
  const out: Record<number, TaskRow[]> = {};
  for (const row of r.rows.map(toTaskRow)) {
    const parent = Number(row.parent_task_id);
    if (!out[parent]) out[parent] = [];
    out[parent].push(row);
  }
  return out;
}

export async function getTaskDependencies(projectId: number) {
  const r = await db.query(
    `SELECT d.task_id, d.depends_on_id FROM task_dependencies d
     JOIN tasks t ON t.id = d.task_id WHERE ${projectTaskScope("t")}`,
    [projectId],
  );
  return r.rows as { task_id: number; depends_on_id: number }[];
}

export async function getTaskProjects(taskId: number) {
  const r = await db.query(
    `SELECT p.id, p.name, s.name AS section_name
     FROM task_project_memberships m
     JOIN projects p ON p.id = m.project_id
     LEFT JOIN sections s ON s.id = m.section_id
     WHERE m.task_id = $1
     UNION
     SELECT p.id, p.name, s.name AS section_name
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN sections s ON s.id = t.section_id
     WHERE t.id = $1 AND t.project_id IS NOT NULL`,
    [taskId],
  );
  return r.rows as { id: number; name: string; section_name: string | null }[];
}

export async function logEvent(taskId: number, actorId: number, kind: string, summary: string) {
  await db.query(
    "INSERT INTO task_events (task_id, actor_id, kind, summary) VALUES ($1, $2, $3, $4)",
    [taskId, actorId, kind, summary],
  );
}

export async function getTaskCustomValues(
  projectId: number,
): Promise<Record<number, Record<number, CustomValue>>> {
  const r = await db.query(
    `SELECT v.task_id, v.field_id, v.value_text, v.value_number,
       v.value_date::text AS value_date, v.value_json
     FROM task_custom_values v JOIN custom_fields f ON f.id = v.field_id
     WHERE f.project_id = $1`,
    [projectId],
  );
  const out: Record<number, Record<number, CustomValue>> = {};
  for (const row of r.rows) {
    if (!out[row.task_id]) out[row.task_id] = {};
    out[row.task_id][row.field_id] = {
      value_text: row.value_text,
      value_number: row.value_number,
      value_date: row.value_date,
      value_json: row.value_json,
    };
  }
  return out;
}

export async function getTaskAttachments(taskId: number): Promise<Attachment[]> {
  const r = await db.query(
    `SELECT a.id, a.task_id, a.file_name, a.mime_type, a.size_bytes::int AS size_bytes,
       u.name AS author_name, a.created_at::text AS created_at
     FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.task_id = $1 ORDER BY a.id`,
    [taskId],
  );
  return r.rows;
}
