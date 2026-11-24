import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/admin-data";
import { withSuperAdminPermission } from "@/lib/api/route";
import {
  isMcpLogOutcomeFilter,
  listAdminMcpRequestLogs,
  MCP_LOG_PAGE_SIZE,
} from "@/lib/services/mcp-admin";

export const GET = withSuperAdminPermission("security.manage", async (req) => {
  const { searchParams } = new URL(req.url);
  const outcome = searchParams.get("outcome") ?? "all";
  if (!isMcpLogOutcomeFilter(outcome)) {
    return NextResponse.json(
      { error: "outcome must be all, ok, error, denied or unauthenticated" },
      { status: 400 },
    );
  }
  const cursorRaw = searchParams.get("cursor");
  let cursor: number | null = null;
  if (cursorRaw !== null && cursorRaw !== "") {
    if (!/^\d+$/.test(cursorRaw)) {
      return NextResponse.json({ error: "cursor must be a positive integer" }, { status: 400 });
    }
    cursor = Number(cursorRaw);
    if (!Number.isSafeInteger(cursor) || cursor <= 0) {
      return NextResponse.json({ error: "cursor must be a positive integer" }, { status: 400 });
    }
  }

  const { workspace_id: workspaceId } = await getSecuritySettings();
  const page = await listAdminMcpRequestLogs(workspaceId, { outcome, cursor });
  return NextResponse.json({
    logs: page.logs,
    next_cursor: page.nextCursor,
    page_size: MCP_LOG_PAGE_SIZE,
  });
});
