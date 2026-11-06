import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = getCurrentUserIdFromRequest(req);
  const r = await db.query(
    "DELETE FROM saved_searches WHERE id = $1::bigint AND user_id = $2 RETURNING id",
    [id, uid],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: Number(id) });
}
