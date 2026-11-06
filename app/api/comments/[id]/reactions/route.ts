import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";

// Toggle a reaction. Body: { emoji: string } (1-12 chars).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const emoji = typeof body?.emoji === "string" ? body.emoji.trim() : "";
  if ([...emoji].length < 1 || [...emoji].length > 12) {
    return NextResponse.json({ error: "emoji (1-12 chars) is required" }, { status: 400 });
  }
  const c = await db.query("SELECT id FROM comments WHERE id = $1::bigint", [id]);
  if (c.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const me = await db.query("SELECT id FROM users WHERE id = $1", [uid]);
  if (me.rowCount === 0) return NextResponse.json({ error: "unknown user" }, { status: 403 });
  const existing = await db.query(
    "SELECT 1 FROM comment_reactions WHERE comment_id = $1::bigint AND user_id = $2 AND emoji = $3",
    [id, uid, emoji],
  );
  let added: boolean;
  if ((existing.rowCount ?? 0) > 0) {
    await db.query(
      "DELETE FROM comment_reactions WHERE comment_id = $1::bigint AND user_id = $2 AND emoji = $3",
      [id, uid, emoji],
    );
    added = false;
  } else {
    await db.query("INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES ($1::bigint, $2, $3)", [
      id,
      uid,
      emoji,
    ]);
    added = true;
  }
  const counts = await db.query(
    `SELECT emoji, COUNT(*)::int AS n,
       BOOL_OR(user_id = $2) AS mine
     FROM comment_reactions WHERE comment_id = $1::bigint GROUP BY emoji ORDER BY n DESC, emoji`,
    [id, uid],
  );
  return NextResponse.json({ added, reactions: counts.rows });
}
