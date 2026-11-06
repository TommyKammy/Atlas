import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";

export async function GET(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const r = await db.query(
    `SELECT p.id, p.name FROM user_favorites f JOIN projects p ON p.id = f.project_id
     WHERE f.user_id = $1 ORDER BY p.id`,
    [uid],
  );
  return NextResponse.json(r.rows);
}

// Toggle a favorite. Body: { project_id: number }.
export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const pid = body?.project_id;
  if (!Number.isInteger(pid)) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  const me = await db.query("SELECT id FROM users WHERE id = $1", [uid]);
  if (me.rowCount === 0) return NextResponse.json({ error: "unknown user" }, { status: 403 });
  const p = await db.query("SELECT id FROM projects WHERE id = $1::bigint", [pid]);
  if (p.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const existing = await db.query(
    "SELECT 1 FROM user_favorites WHERE user_id = $1 AND project_id = $2::bigint",
    [uid, pid],
  );
  let starred: boolean;
  if ((existing.rowCount ?? 0) > 0) {
    await db.query("DELETE FROM user_favorites WHERE user_id = $1 AND project_id = $2::bigint", [uid, pid]);
    starred = false;
  } else {
    await db.query("INSERT INTO user_favorites (user_id, project_id) VALUES ($1, $2::bigint)", [uid, pid]);
    starred = true;
  }
  return NextResponse.json({ starred });
}
