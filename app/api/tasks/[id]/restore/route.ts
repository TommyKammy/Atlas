import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/data";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyTask } from "@/lib/notify";

// Restore a soft-deleted task subtree.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM tasks WHERE id = $1::bigint AND deleted_at IS NOT NULL
       UNION ALL SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id
     ) UPDATE tasks SET deleted_at = NULL, updated_at = now() WHERE id IN (SELECT id FROM sub) RETURNING id`,
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyTask(id);
  await logEvent(Number(id), getCurrentUserIdFromRequest(req), "restored", "タスクをゴミ箱から復元しました").catch(
    () => undefined,
  );
  return NextResponse.json({ restored: Number(id) });
}
