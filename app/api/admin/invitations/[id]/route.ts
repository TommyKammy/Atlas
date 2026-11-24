import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, defaultWorkspaceId } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";

export const DELETE = withAdminPermission("members.manage", async (_req, { uid, params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM invitations WHERE id = $1::bigint RETURNING id", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "invitation.revoke", {
    entity: "invitation",
    entityId: id,
    workspaceId: await defaultWorkspaceId(),
  });
  return NextResponse.json({ deleted: Number(id) });
});
