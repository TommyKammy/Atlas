import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await db.query("SELECT project_id FROM saved_views WHERE id = $1::bigint", [id]);
  const r = await db.query("DELETE FROM saved_views WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(owner.rows[0]?.project_id ?? null);
  return NextResponse.json({ deleted: Number(id) });
}
