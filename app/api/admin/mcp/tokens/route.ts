import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/admin-data";
import { withSuperAdminPermission } from "@/lib/api/route";
import { listAdminMcpTokens } from "@/lib/services/mcp-admin";

export const GET = withSuperAdminPermission("security.manage", async () => {
  const { workspace_id: workspaceId } = await getSecuritySettings();
  return NextResponse.json({ tokens: await listAdminMcpTokens(workspaceId) });
});
