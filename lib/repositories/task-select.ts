import type { TaskRow } from "../data";

/**
 * Shared task projection. Keep this list in sync with `TaskRow`; every task
 * query must return the full row so UI code never sees partial shapes.
 */
export const TASK_SELECT_COLS = `
  t.id, t.project_id, t.section_id, t.parent_task_id, t.name, t.description, t.description_doc,
  t.assignee_id, u.name AS assignee_name, t.created_by, cu.name AS creator_name, t.completed,
  t.completed_at::text AS completed_at,
  t.start_on::text, t.due_on::text, t.progress, t.status, t.position,
  t.created_at::text AS created_at, t.updated_at::text AS updated_at, t.recurrence,
  p.name AS project_name,
  (SELECT COUNT(*)::int FROM task_likes tl WHERE tl.task_id = t.id) AS like_count,
  (SELECT COUNT(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
  (SELECT COUNT(*)::int FROM tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count,
  (SELECT COUNT(*)::int FROM task_attachments ta WHERE ta.task_id = t.id) AS attachment_count,
  (SELECT COUNT(*)::int FROM task_dependencies td WHERE td.task_id = t.id) AS blocked_by_count,
  (SELECT COUNT(*)::int FROM task_dependencies td WHERE td.depends_on_id = t.id) AS blocking_count,
  (
    SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('id', c.id, 'name', c.name)), '[]'::json)
    FROM (
      SELECT u2.id, u2.name FROM users u2 WHERE u2.id = t.assignee_id
      UNION
      SELECT cu2.id, cu2.name FROM users cu2 WHERE cu2.id = t.created_by
      UNION
      SELECT c.author_id AS id, au.name
      FROM comments c JOIN users au ON au.id = c.author_id
      WHERE c.task_id = t.id
    ) c
    WHERE c.id IS NOT NULL
  ) AS collaborators
`;

export const TASK_FROM = `
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assignee_id
  LEFT JOIN users cu ON cu.id = t.created_by
  LEFT JOIN projects p ON p.id = t.project_id
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
    like_count: Number(row.like_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    subtask_count: Number(row.subtask_count ?? 0),
    attachment_count: Number(row.attachment_count ?? 0),
    blocked_by_count: Number(row.blocked_by_count ?? 0),
    blocking_count: Number(row.blocking_count ?? 0),
    collaborators: Array.isArray(row.collaborators)
      ? row.collaborators
          .map((person) => ({ id: Number(person.id), name: String(person.name) }))
          .filter((person) => Number.isInteger(person.id))
      : [],
  };
}
