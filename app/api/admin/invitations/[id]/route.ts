import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const uid = getCurrentUserIdFromRequest(req);
  const admin = await db.query(
    "SELECT is_admin FROM users WHERE id = $1 AND deactivated_at IS NULL",
    [uid],
  );
  if (admin.rowCount === 0 || admin.rows[0].is_admin !== true) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const r = await db.query("DELETE FROM invitations WHERE id = $1::bigint RETURNING id", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "invitation.revoke", { entity: "invitation", entityId: id });
  return NextResponse.json({ deleted: Number(id) });
}
