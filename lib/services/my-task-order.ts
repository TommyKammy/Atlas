import { db, withTransaction, type Queryable } from "../db";
import { badRequest, conflict } from "../api/errors";
import {
  applyMyTaskMove, MY_TASK_MOVE_TASK_LIMIT, myTaskOrderEqual,
  type MyTaskOrderRequest, type MyTaskSnapshot, type MyTaskSnapshotItem,
} from "../my-task-order";

/** Matches getMyTasks' assigned/incomplete/top-level/non-deleted display scope. */
async function orderedSnapshot(uid: number, q: Queryable): Promise<MyTaskSnapshot> {
  const result = await q.query(
    `SELECT t.id AS task_id, t.due_on::text AS due_on, t.updated_at::text AS updated_at
     FROM tasks t LEFT JOIN my_task_orders o ON o.task_id = t.id AND o.user_id = $1
     WHERE t.assignee_id = $1 AND t.completed = FALSE
       AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
     ORDER BY o.position NULLS LAST, t.due_on NULLS LAST, t.position, t.id LIMIT $2`,
    [uid, MY_TASK_MOVE_TASK_LIMIT + 1],
  );
  return {
    items: result.rows.map((row): MyTaskSnapshotItem => ({
      task_id: Number(row.task_id), due_on: row.due_on as string | null, updated_at: String(row.updated_at),
    })),
    overflow: result.rows.length > MY_TASK_MOVE_TASK_LIMIT,
  };
}

export const getMyTaskOrderSnapshot = (uid: number) => orderedSnapshot(uid, db);

async function writePositions(q: Queryable, uid: number, items: { task_id: number; position: number }[]) {
  const result = await q.query(
    `INSERT INTO my_task_orders AS existing_order (user_id, task_id, position, updated_at)
     SELECT $1, input.task_id, input.position, now()
     FROM unnest($2::bigint[], $3::double precision[]) AS input(task_id, position)
     ON CONFLICT (user_id, task_id) DO UPDATE
       SET position = EXCLUDED.position, updated_at = now()
       WHERE existing_order.position IS DISTINCT FROM EXCLUDED.position`,
    [uid, items.map((item) => item.task_id), items.map((item) => item.position)],
  );
  return result.rowCount ?? 0;
}

export async function saveMyTaskOrder(uid: number, request: MyTaskOrderRequest) {
  return withTransaction(async (q) => {
    // Other tabs' relative moves serialize without taking any shared-task write.
    await q.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas:my-task-order:' || $1::text, 0))", [uid]);
    if (request.kind === "items") {
      const ids = request.items.map((item) => item.task_id);
      const owned = await q.query(
        `SELECT id, due_on::text AS due_on FROM tasks
         WHERE assignee_id = $1 AND completed = FALSE AND parent_task_id IS NULL
           AND deleted_at IS NULL AND id = ANY($2::bigint[]) ORDER BY id FOR KEY SHARE`,
        [uid, ids],
      );
      if (owned.rows.length !== ids.length) throw badRequest("task is not assigned to the current user");
      const due = new Map(owned.rows.map((row) => [Number(row.id), row.due_on as string | null]));
      // Old clients may send their date snapshot, but it is never an instruction
      // to overwrite dates. Reject the entire batch before touching any orders.
      if (request.items.some((item) => "due_on" in item && item.due_on !== due.get(item.task_id))) {
        throw conflict("task dates changed; refresh and use the task PATCH endpoint to change a date");
      }
      const changed = await writePositions(q, uid, request.items);
      return { count: request.items.length, changed };
    }
    const snapshot = await orderedSnapshot(uid, q);
    if (snapshot.overflow) throw badRequest(`My Tasks ordering supports at most ${MY_TASK_MOVE_TASK_LIMIT} tasks`);
    const ids = snapshot.items.map((item) => item.task_id);
    let next: number[];
    try {
      next = applyMyTaskMove(ids, request.move);
    } catch {
      throw conflict("task eligibility changed; refresh My Tasks");
    }
    if (myTaskOrderEqual(ids, next)) return { count: 0, changed: 0 };
    // Protect the FK targets from concurrent deletion, always in ID order.
    // KEY SHARE does not rewrite tasks or advance their optimistic versions.
    const locked = await q.query(
      `SELECT id FROM tasks WHERE id = ANY($1::bigint[]) AND assignee_id = $2
       AND completed = FALSE AND parent_task_id IS NULL AND deleted_at IS NULL
       ORDER BY id FOR KEY SHARE`,
      [ids, uid],
    );
    if (locked.rows.length !== ids.length) throw conflict("task eligibility changed; refresh My Tasks");
    const changed = await writePositions(q, uid, next.map((task_id, index) => ({ task_id, position: (index + 1) * 1000 })));
    return { count: next.length, changed };
  });
}
