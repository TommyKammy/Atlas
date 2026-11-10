import { conflict } from "@/lib/api/errors";
import { withTransaction } from "@/lib/db";

const TASK_TREE = `WITH RECURSIVE tree(root_id, task_id) AS (
  SELECT id, id FROM tasks WHERE id = ANY($1::bigint[])
  UNION
  SELECT tree.root_id, t.id FROM tree JOIN tasks t ON t.parent_task_id = tree.task_id
)`;

/** Update or purge a tree only within the primary project authorized for each root. */
export async function mutateTaskTrees(
  authorizedRoots: ReadonlyMap<number, number | null>,
  operation: "trash" | "purge" | "restore",
): Promise<number> {
  const ids = [...authorizedRoots.keys()];
  return withTransaction(async (q) => {
    // Hold row locks on the tree before deciding which rows the mutation may
    // affect. A new parent link needs a foreign-key lock on its target row.
    const locked = await q.query<{ id: number }>(
      `${TASK_TREE}
       SELECT id FROM tasks WHERE id IN (SELECT task_id FROM tree) ORDER BY id FOR UPDATE`,
      [ids],
    );
    const lockedIds = new Set(locked.rows.map((row) => row.id));
    const current = await q.query<{ root_id: number; task_id: number; project_id: number | null }>(
      `${TASK_TREE}
       SELECT tree.root_id, tree.task_id, COALESCE(
         t.project_id,
         (SELECT project_id FROM task_project_memberships WHERE task_id = t.id ORDER BY project_id LIMIT 1),
         (SELECT project_id FROM tasks WHERE id = t.parent_task_id)
       ) AS project_id
       FROM tree JOIN tasks t ON t.id = tree.task_id`,
      [ids],
    );
    for (const row of current.rows) {
      if (!lockedIds.has(row.task_id)) throw conflict("task hierarchy changed; retry");
      if (row.project_id !== authorizedRoots.get(row.root_id)) {
        throw conflict("task hierarchy crosses projects or the primary project changed");
      }
    }

    if (operation === "purge") {
      const result = await q.query("DELETE FROM tasks WHERE id = ANY($1::bigint[])", [ids]);
      return result.rowCount ?? 0;
    }

    const result = await q.query(
      operation === "trash"
        ? `WITH RECURSIVE sub(id) AS (
             SELECT id FROM tasks WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL
             UNION
             SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id WHERE t.deleted_at IS NULL
           ) UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id IN (SELECT id FROM sub)`
        : `WITH RECURSIVE sub(id) AS (
             SELECT id FROM tasks WHERE id = ANY($1::bigint[]) AND deleted_at IS NOT NULL
             UNION
             SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id
           ) UPDATE tasks SET deleted_at = NULL, updated_at = now() WHERE id IN (SELECT id FROM sub)`,
      [ids],
    );
    return result.rowCount ?? 0;
  });
}
