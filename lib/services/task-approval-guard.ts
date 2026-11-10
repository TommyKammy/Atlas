import type { Queryable } from "../db";
import { conflict } from "../api/errors";

/** Call after locking the task rows, so a new request cannot race a normal edit. */
export async function assertOrdinaryTaskMutation(
  q: Queryable,
  taskIds: number[],
  fields: Record<string, unknown>,
): Promise<void> {
  if (!("completed" in fields) && fields.is_milestone !== true &&
      !("recurrence" in fields && fields.recurrence !== "none")) return;
  const approvals = await q.query(
    "SELECT task_id FROM task_approvals WHERE task_id = ANY($1::bigint[]) LIMIT 1",
    [taskIds],
  );
  if (approvals.rowCount) {
    throw conflict("承認タスクは専用の承認・再申請操作を使用してください。マイルストーンや繰り返しとは併用できません。");
  }
}
