import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifySection } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sec = await db.query("SELECT project_id FROM sections WHERE id = $1::bigint", [id]);
  if (sec.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const auth = await requireProjectPermission(_req, sec.rows[0].project_id, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query("DELETE FROM sections WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifySection(id);
  await audit(getCurrentUserIdFromRequest(_req), "section.delete", { entity: "section", entityId: id });
  return NextResponse.json({ deleted: Number(id) });
}
