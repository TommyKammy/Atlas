import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/admin-data";
import { withSuperAdminPermission } from "@/lib/api/route";
import { revokeAdminPersonalToken } from "@/lib/services/mcp-admin";

export const DELETE = withSuperAdminPermission("security.manage", async (_req, { uid, params }) => {
  const { workspace_id: workspaceId } = await getSecuritySettings();
  const tokenId = Number(params.id);
  const revoked = await revokeAdminPersonalToken(uid, workspaceId, tokenId);
  return NextResponse.json({ revoked: revoked.id });
});
