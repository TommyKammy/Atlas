import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyProject } from "@/lib/notify";
import { requireProjectPermission } from "@/lib/api-project-auth";

const SORTS = new Set(["position", "due", "name", "progress"]);
const GROUPS = new Set(["section", "assignee", "status"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(projectId), "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    "SELECT id, name, view_type, filters, sort_key, group_by FROM saved_views WHERE project_id = $1::bigint ORDER BY id",
    [projectId],
  );
  return NextResponse.json(r.rows);
}

export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json();
  const { project_id, name, filters, sort_key, group_by } = body;
  if (!project_id || !name || String(name).trim() === "") {
    return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const f =
    filters && typeof filters === "object"
      ? {
          hide_completed: filters.hide_completed === true,
          assignee: typeof filters.assignee === "string" ? filters.assignee : "",
          status: typeof filters.status === "string" ? filters.status : "",
        }
      : {};
  const r = await db.query(
    `INSERT INTO saved_views (project_id, name, view_type, filters, sort_key, group_by, created_by)
     VALUES ($1::bigint, $2, 'list', $3::jsonb, $4, $5, $6) RETURNING id`,
    [
      project_id,
      String(name).trim(),
      JSON.stringify(f),
      SORTS.has(sort_key) ? sort_key : "position",
      GROUPS.has(group_by) ? group_by : "section",
      uid,
    ],
  );
  await notifyProject(project_id);
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
