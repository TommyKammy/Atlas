import type { TaskRow } from "../data";

/**
 * Shared task projection. Keep this list in sync with `TaskRow`; every task
 * query must return the full row so UI code never sees partial shapes.
 */
export const TASK_SELECT_COLS = `
  t.id, t.project_id, t.section_id, t.parent_task_id, t.name, t.description,
  t.assignee_id, u.name AS assignee_name, t.created_by, cu.name AS creator_name, t.completed,
  t.completed_at::text AS completed_at,
  t.start_on::text, t.due_on::text, t.progress, t.status, t.position,
  t.created_at::text AS created_at, t.updated_at::text AS updated_at, t.recurrence,
  (SELECT COUNT(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
  (SELECT COUNT(*)::int FROM tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count
`;

export const TASK_FROM = `
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assignee_id
  LEFT JOIN users cu ON cu.id = t.created_by
`;

/** Normalize a DB task row into the public `TaskRow` shape. */
export function toTaskRow(row: TaskRow): TaskRow {
  return {
    ...row,
    id: Number(row.id),
    project_id: row.project_id === null ? null : Number(row.project_id),
    section_id: row.section_id === null ? null : Number(row.section_id),
    parent_task_id: row.parent_task_id === null ? null : Number(row.parent_task_id),
    assignee_id: row.assignee_id === null ? null : Number(row.assignee_id),
    created_by: row.created_by === null ? null : Number(row.created_by),
    progress: Number(row.progress),
    position: Number(row.position),
    comment_count: Number(row.comment_count ?? 0),
    subtask_count: Number(row.subtask_count ?? 0),
  };
}
