/** Tasks shown in a project's list/stats: primary project plus multi-home memberships. */
export function projectTaskScope(alias: string, project = "$1"): string {
  return `(${alias}.project_id = ${project} OR EXISTS (
    SELECT 1 FROM task_project_memberships m
    WHERE m.task_id = ${alias}.id AND m.project_id = ${project}
  ))`;
}

/** Parent-derived visibility stops at a legacy edge with different primary projects. */
export function compatibleTaskParent(child: string, parent: string): string {
  return `(${child}.project_id IS NULL OR ${child}.project_id = ${parent}.project_id)`;
}

/** Include compatible children of parents visible in the project. */
export function projectTaskReadScope(alias: string, project = "$1"): string {
  return `(${projectTaskScope(alias, project)} OR EXISTS (
    SELECT 1 FROM tasks inherited_parent
    WHERE inherited_parent.id = ${alias}.parent_task_id
      AND ${compatibleTaskParent(alias, "inherited_parent")}
      AND ${projectTaskScope("inherited_parent", project)}
  ))`;
}
