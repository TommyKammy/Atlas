import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { getProjectTabs } from "@/lib/data";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

const VIEW_TYPES = new Set([
  "overview",
  "dashboard",
  "list",
  "board",
  "timeline",
  "calendar",
  "messages",
  "knowledge",
  "files",
]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(projectId), "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await getProjectTabs(Number(projectId)));
}

export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const { project_id, name, view_type } = body ?? {};
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!name || String(name).trim() === "" || !VIEW_TYPES.has(view_type)) {
    return NextResponse.json({ error: "name and a valid view_type are required" }, { status: 400 });
  }
  const max = await db.query(
    "SELECT COALESCE(MAX(position), 0) AS position FROM project_tabs WHERE project_id = $1",
    [project_id],
  );
  const key = `custom:${randomUUID()}`;
  const r = await db.query(
    `INSERT INTO project_tabs (project_id, tab_key, name, view_type, position, is_custom, created_by)
     VALUES ($1::bigint, $2, $3, $4, $5, true, $6) RETURNING id`,
    [project_id, key, String(name).trim(), view_type, Number(max.rows[0].position) + 1000, uid],
  );
  await notifyProject(Number(project_id));
  await audit(uid, "project_tab.create", {
    entity: "project_tab",
    entityId: r.rows[0].id,
    projectId: Number(project_id),
  });
  return NextResponse.json({ id: r.rows[0].id, tab_key: key }, { status: 201 });
}
