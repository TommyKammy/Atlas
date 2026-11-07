import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withTask } from "@/lib/api/route";

async function likeState(taskId: number, userId: number) {
  const r = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM task_likes WHERE task_id = $1::bigint) AS count,
       EXISTS (SELECT 1 FROM task_likes WHERE task_id = $1::bigint AND user_id = $2) AS liked`,
    [taskId, userId],
  );
  return { count: Number(r.rows[0]?.count ?? 0), liked: r.rows[0]?.liked === true };
}

export const GET = withTask("view", async (_req, { taskId, uid }) => {
  return NextResponse.json(await likeState(taskId, uid));
});

// Toggle the current user's like on a task.
export const POST = withTask("view", async (_req, { taskId, uid }) => {
  const existing = await db.query(
    "SELECT 1 FROM task_likes WHERE task_id = $1::bigint AND user_id = $2",
    [taskId, uid],
  );
  if ((existing.rowCount ?? 0) > 0) {
    await db.query("DELETE FROM task_likes WHERE task_id = $1::bigint AND user_id = $2", [taskId, uid]);
  } else {
    await db.query("INSERT INTO task_likes (task_id, user_id) VALUES ($1::bigint, $2)", [taskId, uid]);
  }
  return NextResponse.json(await likeState(taskId, uid));
});
