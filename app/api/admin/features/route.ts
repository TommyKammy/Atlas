import { NextResponse } from "next/server";
import { withAdminPermission } from "@/lib/api/route";
import { getAdminWorkspace } from "@/lib/admin-data";
import { getWorkspaceFeatures, updateWorkspaceFeatures } from "@/lib/services/workspace-features";

async function workspaceId(): Promise<number | null> {
  const workspace = await getAdminWorkspace();
  return workspace ? Number(workspace.id) : null;
}

/** Optional workspace features (Admin → Features). */
export const GET = withAdminPermission("workspace.manage", async () => {
  const id = await workspaceId();
  if (id === null) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  return NextResponse.json({ features: await getWorkspaceFeatures(id) });
});

export const PATCH = withAdminPermission("workspace.manage", async (req, { uid }) => {
  const id = await workspaceId();
  if (id === null) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  return NextResponse.json({ features: await updateWorkspaceFeatures(uid, id, body) });
});
