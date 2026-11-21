import { NextResponse } from "next/server";
import { getSecuritySettings } from "@/lib/admin-data";
import { db } from "@/lib/db";
import { withSuperAdminPermission } from "@/lib/api/route";

const PAGE_SIZE = 50;
const STATUSES = new Set(["all", "success", "failure"]);

export const GET = withSuperAdminPermission("security.manage", async (req) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "all";
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: "status must be all, success or failure" }, { status: 400 });
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
  const params: unknown[] = [workspaceId];
  const where = ["l.workspace_id = $1"];
  if (cursor !== null) {
    params.push(cursor);
    where.push(`l.id < $${params.length}`);
  }
  if (status === "success") where.push("l.status < 400");
  if (status === "failure") where.push("l.status >= 400");

  const result = await db.query(
    `SELECT l.id, l.token_id, t.name AS token_name, l.idp, l.method, l.path,
       l."filter", l.status, l.scim_type, l.detail, l.user_id,
       u.name AS user_name, u.email AS user_email, l.client_ip,
       l.created_at::text AS created_at
     FROM scim_request_log l
     LEFT JOIN scim_tokens t ON t.id = l.token_id
     LEFT JOIN users u ON u.id = l.user_id
     WHERE ${where.join(" AND ")}
     ORDER BY l.id DESC
     LIMIT ${PAGE_SIZE + 1}`,
    params,
  );
  const rows = result.rows.slice(0, PAGE_SIZE);
  const nextCursor = result.rows.length > PAGE_SIZE
    ? Number(rows[rows.length - 1]?.id ?? 0) || null
    : null;
  return NextResponse.json({
    logs: rows,
    next_cursor: nextCursor,
    page_size: PAGE_SIZE,
  });
});
