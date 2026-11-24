import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/admin-data";
import { withSuperAdminPermission } from "@/lib/api/route";
import { revokeAdminOAuthFamily } from "@/lib/services/mcp-admin";

export const DELETE = withSuperAdminPermission("security.manage", async (_req, { uid, params }) => {
  const { workspace_id: workspaceId } = await getSecuritySettings();
  const revoked = await revokeAdminOAuthFamily(uid, workspaceId, params.familyId);
  return NextResponse.json({ revoked: revoked.family_id });
});
