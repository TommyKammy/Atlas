import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";

/** Remove a field-library template (creator or workspace admin). */
export const DELETE = withUser(async (_req, { uid, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const entry = await db.query(
    "SELECT id, workspace_id, created_by FROM field_library WHERE id = $1::bigint",
    [id],
  );
  if (entry.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const user = await db.query("SELECT is_admin FROM users WHERE id = $1::bigint", [uid]);
  const allowed = user.rows[0]?.is_admin === true || Number(entry.rows[0].created_by) === uid;
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.query("DELETE FROM field_library WHERE id = $1::bigint", [id]);
  return NextResponse.json({ deleted: id });
});
