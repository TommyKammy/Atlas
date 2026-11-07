import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";

// Mark feed entries as read for the current user.
// Body: { comment_id } | { event_id } | { all: true, workspace_id }
export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const { comment_id, event_id, all, workspace_id } = body ?? {};
  if (all) {
    if (!workspace_id) {
      return NextResponse.json({ error: "workspace_id is required for all" }, { status: 400 });
    }
    const c = await db.query(
      `INSERT INTO inbox_reads (comment_id, user_id)
       SELECT c.id, $1 FROM comments c JOIN tasks t ON t.id = c.task_id
       JOIN projects p ON p.id = t.project_id
       WHERE p.workspace_id = $2 AND (c.author_id IS NULL OR c.author_id <> $1)
       ON CONFLICT DO NOTHING`,
      [uid, workspace_id],
    );
    const e = await db.query(
      `INSERT INTO inbox_reads (event_id, user_id)
       SELECT e.id, $1 FROM task_events e JOIN tasks t ON t.id = e.task_id
       JOIN projects p ON p.id = t.project_id
       WHERE p.workspace_id = $2 AND (e.actor_id IS NULL OR e.actor_id <> $1)
       ON CONFLICT DO NOTHING`,
      [uid, workspace_id],
    );
    return NextResponse.json({ marked: (c.rowCount ?? 0) + (e.rowCount ?? 0) });
  }
  if (comment_id) {
    await db.query(
      "INSERT INTO inbox_reads (comment_id, user_id) VALUES ($1::bigint, $2) ON CONFLICT DO NOTHING",
      [comment_id, uid],
    );
    return NextResponse.json({ ok: true });
  }
  if (event_id) {
    await db.query(
      "INSERT INTO inbox_reads (event_id, user_id) VALUES ($1::bigint, $2) ON CONFLICT DO NOTHING",
      [event_id, uid],
    );
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "comment_id, event_id or all is required" }, { status: 400 });
});
