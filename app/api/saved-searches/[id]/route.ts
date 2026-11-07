import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";

export const DELETE = withUser(async (_req, { uid, params }) => {
  const id = params.id;
  const r = await db.query(
    "DELETE FROM saved_searches WHERE id = $1::bigint AND user_id = $2 RETURNING id",
    [id, uid],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: Number(id) });
});
