import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { badRequest } from "@/lib/api/errors";
import { getSidebarProjects } from "@/lib/repositories/sidebar-projects";
import { reorderSidebarProjects } from "@/lib/services/sidebar-project-order";

export const GET = withUser(async (req, { uid }) => {
  const workspaceId = Number(new URL(req.url).searchParams.get("workspace_id"));
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) throw badRequest("ワークスペースが無効です");
  const projects = await getSidebarProjects(workspaceId, uid);
  return NextResponse.json({ order: projects.map(project => project.id) });
});

export const POST = withUser(async (req, { uid }) => {
  return NextResponse.json(await reorderSidebarProjects(uid, await req.json().catch(() => null)));
});
