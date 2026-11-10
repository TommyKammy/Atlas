import type { Queryable } from "../db";
import type { DomainEventRow } from "../domain/events";

/**
 * Task fields available to automation conditions and templates. Keep this
 * projection small and explicit: every column is part of the rule contract.
 */
export const TASK_RULE_SNAPSHOT_COLS = `
  t.id, t.project_id,
  CASE WHEN t.project_id = $2::bigint THEN t.section_id ELSE membership.section_id END AS section_id,
  t.parent_task_id, t.name, t.description,
  t.assignee_id, t.created_by, t.completed, t.start_on::text AS start_on,
  t.due_on::text AS due_on, t.progress, t.status, t.is_milestone, t.position,
  t.created_at::text AS created_at, t.updated_at::text AS updated_at
`;

/** Reuse the exact automation subject scope for searchable editor task choices. */
export function taskRuleScopeSql({ singleTask = true, lock = true } = {}): string {
  return `
  FROM tasks t
  LEFT JOIN LATERAL (
    SELECT m.task_id, m.section_id
    FROM task_project_memberships m
    WHERE m.task_id = t.id AND m.project_id = $2::bigint
    ${lock ? "FOR SHARE" : ""}
  ) membership ON TRUE
  WHERE ${singleTask ? "t.id = $1::bigint AND" : ""} t.deleted_at IS NULL
    AND (t.project_id = $2::bigint OR membership.task_id IS NOT NULL OR (
      t.project_id IS NULL AND EXISTS (
        SELECT 1 FROM tasks parent
        WHERE parent.id = t.parent_task_id AND parent.project_id = $2::bigint
          AND parent.deleted_at IS NULL
        ${lock ? "FOR SHARE" : ""}
      )
    ))
`;
}

const TASK_RULE_SCOPE_SQL = taskRuleScopeSql();

export const TASK_RULE_SNAPSHOT_SQL = `
  SELECT ${TASK_RULE_SNAPSHOT_COLS}
  ${TASK_RULE_SCOPE_SQL}
`;

export const STALE_AUTOMATION_SUBJECT = "automation subject is no longer in the active project";

type RuleSubject = Pick<DomainEventRow, "workspace_id" | "project_id" | "subject_type" | "subject_id">;

/** Use within a read-only repeatable-read transaction for a consistent preview. */
export async function readRuleSubject(
  q: Queryable,
  event: RuleSubject,
): Promise<{ project: Record<string, unknown>; task: Record<string, unknown> | null } | null> {
  if (event.project_id === null || (event.subject_type === "project" && event.subject_id !== event.project_id)) return null;
  const project = await q.query(
    `SELECT id, name, status, status_color, owner_id, due_on::text AS due_on
     FROM projects WHERE id = $1::bigint AND workspace_id = $2::bigint AND deleted_at IS NULL`,
    [event.project_id, event.workspace_id],
  );
  if (project.rowCount === 0) return null;
  if (event.subject_type !== "task") return { project: project.rows[0], task: null };
  const task = await q.query(`SELECT ${TASK_RULE_SNAPSHOT_COLS} ${taskRuleScopeSql({ lock: false })}`, [event.subject_id, event.project_id]);
  return task.rowCount === 0 ? null : { project: project.rows[0], task: task.rows[0] };
}

/** Check live event scope and hold it through planning or a database action. */
export async function lockRuleSubject(
  q: Queryable,
  event: RuleSubject,
  { snapshot = false, updatesProject = false } = {},
): Promise<{ project: Record<string, unknown>; task: Record<string, unknown> | null } | null> {
  const projectId = event.project_id;
  if (projectId === null || (event.subject_type === "project" && event.subject_id !== projectId)) return null;

  if (event.subject_type === "task") {
    // Membership changes and primary moves take the task lock. Read membership
    // in a new statement afterward, including changes committed while waiting.
    const taskLock = await q.query(
      "SELECT id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
      [event.subject_id],
    );
    if (taskLock.rowCount === 0) return null;
  }

  const project = await q.query(
    `SELECT ${snapshot ? "id, name, status, status_color, owner_id, due_on::text AS due_on" : "id"}
     FROM projects
     WHERE id = $1::bigint AND workspace_id = $2::bigint AND deleted_at IS NULL
     ${updatesProject ? "FOR NO KEY UPDATE" : "FOR SHARE"}`,
    [projectId, event.workspace_id],
  );
  if (project.rowCount === 0) return null;
  if (event.subject_type !== "task") return { project: project.rows[0], task: null };

  const task = await q.query(
    snapshot ? TASK_RULE_SNAPSHOT_SQL : `SELECT 1 ${TASK_RULE_SCOPE_SQL}`,
    [event.subject_id, projectId],
  );
  return task.rowCount === 0 ? null : { project: project.rows[0], task: task.rows[0] };
}
