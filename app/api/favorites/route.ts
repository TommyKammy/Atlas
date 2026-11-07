import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser, withProject } from "@/lib/api/route";

export const GET = withUser(async (_req, { uid }) => {
  const r = await db.query(
    `SELECT p.id, p.name FROM user_favorites f JOIN projects p ON p.id = f.project_id
     WHERE f.user_id = $1 ORDER BY p.id`,
    [uid],
  );
  return NextResponse.json(r.rows);
});

// Toggle a favorite. Body: { project_id: number }.
export const POST = withProject("view", async (_req, { uid, projectId: pid }) => {
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
}, { body: true });
