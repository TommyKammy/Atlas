import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";

export async function GET(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const me = await db.query("SELECT is_admin FROM users WHERE id = $1 AND deactivated_at IS NULL", [uid]);
  if (me.rowCount === 0 || me.rows[0].is_admin !== true) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const byDay = async (table: string, extra = "") => {
    const r = await db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(t.id)::int AS n
       FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') AS d
       LEFT JOIN ${table} t ON t.created_at::date = d::date ${extra}
       GROUP BY d ORDER BY d`,
    );
    return r.rows as { day: string; n: number }[];
  };
  const completed = await db.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(e.id)::int AS n
     FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') AS d
     LEFT JOIN task_events e ON e.kind = 'completed' AND e.created_at::date = d::date
     GROUP BY d ORDER BY d`,
  );
  const active = await db.query(
    `SELECT COUNT(DISTINCT actor_id)::int AS n FROM task_events WHERE created_at > NOW() - interval '7 days'`,
  );
  const [created, comments] = await Promise.all([
    byDay("tasks", "AND t.deleted_at IS NULL"),
    byDay("comments"),
  ]);
  return NextResponse.json({
    created,
    completed: completed.rows,
    comments,
    active_users_7d: active.rows[0].n as number,
  });
}
