/**
 * Task fields available to automation conditions and templates. Keep this
 * projection small and explicit: every column is part of the rule contract.
 */
export const TASK_RULE_SNAPSHOT_COLS = `
  t.id, t.project_id, t.section_id, t.parent_task_id, t.name, t.description,
  t.assignee_id, t.created_by, t.completed, t.start_on::text AS start_on,
  t.due_on::text AS due_on, t.progress, t.status, t.is_milestone, t.position,
  t.created_at::text AS created_at, t.updated_at::text AS updated_at
`;

export const TASK_RULE_SNAPSHOT_SQL = `
  SELECT ${TASK_RULE_SNAPSHOT_COLS}
  FROM tasks t WHERE t.id = $1::bigint
`;
