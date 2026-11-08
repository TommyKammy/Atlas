import type { Queryable } from "./db";

/**
 * Preserve tasks that live in more than one project when their primary
 * project is trashed or permanently deleted.
 *
 * The `tasks.project_id` column is the primary home. Extra homes live in
 * `task_project_memberships`. If the primary project goes away, promote the
 * first remaining membership so the task keeps existing for those projects.
 */
export async function detachMultiHomedTasks(q: Queryable, projectId: number): Promise<number> {
  const rows = await q.query(
    `SELECT t.id
     FROM tasks t
     WHERE t.project_id = $1::bigint
       AND EXISTS (
         SELECT 1 FROM task_project_memberships m
         WHERE m.task_id = t.id AND m.project_id <> $1::bigint
       )`,
    [projectId],
  );
  let moved = 0;
  for (const row of rows.rows as { id: number }[]) {
    const target = await q.query(
      `SELECT project_id, section_id
       FROM task_project_memberships
       WHERE task_id = $1::bigint AND project_id <> $2::bigint
       ORDER BY project_id LIMIT 1`,
      [row.id, projectId],
    );
    if (target.rowCount === 0) continue;
    const nextProject = Number(target.rows[0].project_id);
    const nextSection = target.rows[0].section_id === null ? null : Number(target.rows[0].section_id);
    await q.query(
      "UPDATE tasks SET project_id = $1::bigint, section_id = $2::bigint, updated_at = now() WHERE id = $3::bigint",
      [nextProject, nextSection, row.id],
    );
    await q.query(
      "DELETE FROM task_project_memberships WHERE task_id = $1::bigint AND project_id IN ($2::bigint, $3::bigint)",
      [row.id, projectId, nextProject],
    );
    // Subtasks follow their multi-homed parent so a project deletion cannot
    // orphan or cascade-delete a surviving task tree.
    await q.query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM tasks WHERE parent_task_id = $1::bigint
         UNION ALL
         SELECT t.id FROM tasks t JOIN descendants d ON t.parent_task_id = d.id
       )
       UPDATE tasks SET project_id = $2::bigint, section_id = $3::bigint, updated_at = now()
       WHERE id IN (SELECT id FROM descendants) AND project_id = $4::bigint`,
      [row.id, nextProject, nextSection, projectId],
    );
    moved++;
  }
  return moved;
}
