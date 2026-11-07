import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";
import { getAdminWorkspace } from "@/lib/admin-data";

export const GET = withAdminPermission("workspace.manage", async () => {
  const workspace = await getAdminWorkspace();
  if (!workspace) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  return NextResponse.json({ workspace });
});

export const PATCH = withAdminPermission("workspace.manage", async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "organization name is required" }, { status: 400 });
  const ws = await db.query("SELECT id FROM workspaces ORDER BY id LIMIT 1");
  if (ws.rowCount === 0) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const workspaceId = Number(ws.rows[0].id);
  await db.query("UPDATE workspaces SET name = $2 WHERE id = $1", [workspaceId, name]);
  await audit(uid, "workspace.rename", {
    entity: "workspace",
    entityId: workspaceId,
    summary: `organization name -> ${name}`,
  });
  return NextResponse.json({ workspace: await getAdminWorkspace() });
});
