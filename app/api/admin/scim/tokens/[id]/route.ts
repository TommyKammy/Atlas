import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getSecuritySettings } from "@/lib/admin-data";
import { withTransaction } from "@/lib/db";
import { withSuperAdminPermission } from "@/lib/api/route";

export const DELETE = withSuperAdminPermission("security.manage", async (_req, { uid, params }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid token id" }, { status: 400 });
  }
  const { workspace_id: workspaceId } = await getSecuritySettings();
  return withTransaction(async (q) => {
    const revoked = await q.query(
      `UPDATE scim_tokens SET revoked_at = now()
       WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL
       RETURNING id, name, idp`,
      [id, workspaceId],
    );
    if (revoked.rowCount) {
      const row = revoked.rows[0];
      await audit(uid, "security.scim_token.revoke", {
        entity: "scim_token",
        entityId: id,
        workspaceId,
        summary: `SCIM トークンを失効: ${row.name} (${row.idp})`,
      }, q);
      return NextResponse.json({ revoked: id });
    }
    const existing = await q.query(
      "SELECT id FROM scim_tokens WHERE id = $1 AND workspace_id = $2",
      [id, workspaceId],
    );
    if (!existing.rowCount) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Already revoked: keep the operation idempotent for retries.
    return NextResponse.json({ revoked: id });
  });
});
