import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";

/** Reset a member's two-factor enrollment (admin recovery path). */
export const DELETE = withAdminPermission("security.manage", async (_req, { uid: admin, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid user id" }, { status: 400 });
  }
  const r = await db.query(
    `UPDATE users
     SET totp_enabled = FALSE, totp_secret = NULL, totp_pending_secret = NULL,
       totp_recovery_codes = '{}', totp_enrolled_at = NULL
     WHERE id = $1
     RETURNING id, name, totp_enabled`,
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(admin, "user.2fa.reset", {
    entity: "user",
    entityId: id,
    summary: `2FA reset for ${r.rows[0].name}`,
  });
  return NextResponse.json(r.rows[0]);
});
