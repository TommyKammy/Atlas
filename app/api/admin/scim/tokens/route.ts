import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getSecuritySettings } from "@/lib/admin-data";
import { db, withTransaction } from "@/lib/db";
import { withSuperAdminPermission } from "@/lib/api/route";
import { generateScimToken, hashScimToken } from "@/lib/scim/token";

const IDPS = new Set(["entra", "okta", "generic"]);

export const GET = withSuperAdminPermission("security.manage", async () => {
  const { workspace_id: workspaceId } = await getSecuritySettings();
  const result = await db.query(
    `SELECT t.id, t.name, t.idp, t.created_by, u.name AS created_by_name,
       t.created_at::text AS created_at, t.last_used_at::text AS last_used_at,
       t.revoked_at::text AS revoked_at
     FROM scim_tokens t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.workspace_id = $1
     ORDER BY t.id`,
    [workspaceId],
  );
  return NextResponse.json({ tokens: result.rows });
});

export const POST = withSuperAdminPermission("security.manage", async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const idp = typeof body?.idp === "string" && body.idp !== "" ? body.idp : "generic";
  if (name === "") return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!IDPS.has(idp)) return NextResponse.json({ error: "idp must be entra, okta or generic" }, { status: 400 });
  const { workspace_id: workspaceId } = await getSecuritySettings();
  const token = generateScimToken();
  const outcome = await withTransaction(async (q) => {
    const inserted = await q.query(
      `INSERT INTO scim_tokens (workspace_id, name, idp, token_hash, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, idp, created_by, created_at::text AS created_at,
         last_used_at::text AS last_used_at, revoked_at::text AS revoked_at`,
      [workspaceId, name, idp, hashScimToken(token), uid],
    );
    const record = inserted.rows[0];
    await audit(uid, "security.scim_token.create", {
      entity: "scim_token",
      entityId: record.id,
      workspaceId,
      summary: `SCIM トークンを発行: ${name} (${idp})`,
    }, q);
    return record;
  });
  // The plaintext token is returned exactly once and never persisted or audited.
  return NextResponse.json({ ...outcome, token }, { status: 201 });
});
