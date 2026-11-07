import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";

// Workspace directory used by project member pickers and share dialogs.
export const GET = withUser(async () => {
  const r = await db.query(
    `SELECT id, name, email, title, avatar_url, is_guest, is_admin
     FROM users WHERE deactivated_at IS NULL ORDER BY id`,
  );
  return NextResponse.json({ users: r.rows });
});
