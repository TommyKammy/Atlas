import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { notifyTask } from "@/lib/notify";
import { withTask } from "@/lib/api/route";

// Restore a soft-deleted task subtree.
export const POST = withTask("edit", async (_req, { taskId, uid }) => {
  const r = await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM tasks WHERE id = $1::bigint AND deleted_at IS NOT NULL
       UNION ALL SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id
     ) UPDATE tasks SET deleted_at = NULL, updated_at = now() WHERE id IN (SELECT id FROM sub) RETURNING id`,
    [taskId],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyTask(taskId);
  await logEvent(taskId, uid, "restored", "タスクをゴミ箱から復元しました").catch(
    () => undefined,
  );
  return NextResponse.json({ restored: taskId });
});
