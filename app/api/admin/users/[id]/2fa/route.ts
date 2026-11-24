import { NextResponse } from "next/server";
import { revokeSessionsAndMcpTokens, withManagedUser } from "@/lib/services/admin-user-access";
import { audit, defaultWorkspaceId } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";

/** Reset a member's two-factor enrollment (admin recovery path). */
export const DELETE = withAdminPermission("security.manage", async (_req, { uid: admin, params }) => {
  const id = Number(params.id);
  return withManagedUser(admin, id, "security.manage", async (q) => {
    const r = await q.query(
      `UPDATE users
       SET totp_enabled = FALSE, totp_secret = NULL, totp_pending_secret = NULL,
         totp_recovery_codes = '{}', totp_enrolled_at = NULL
       WHERE id = $1
       RETURNING id, name, totp_enabled`,
      [id],
    );
    if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    // A 2FA reset invalidates every session and MCP token atomically.
    await revokeSessionsAndMcpTokens(q, id, { deleteAllSessions: true });
    await audit(admin, "user.2fa.reset", {
      entity: "user",
      entityId: id,
      workspaceId: await defaultWorkspaceId(q),
      summary: `2FA reset for ${r.rows[0].name}`,
    }, q);
    return NextResponse.json(r.rows[0]);
  });
});
