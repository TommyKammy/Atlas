/** Tasks shown in a project's list/stats: primary project plus multi-home memberships. */
export function projectTaskScope(alias: string): string {
  return `(${alias}.project_id = $1 OR EXISTS (
    SELECT 1 FROM task_project_memberships m
    WHERE m.task_id = ${alias}.id AND m.project_id = $1
  ))`;
}
