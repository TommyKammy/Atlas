import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";

const SORTS = new Set(["position", "due", "name", "progress"]);
const GROUPS = new Set(["section", "assignee", "status"]);

export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    "SELECT id, name, view_type, filters, sort_key, group_by FROM saved_views WHERE project_id = $1::bigint ORDER BY id",
    [projectId],
  );
  return NextResponse.json(r.rows);
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const { name, filters, sort_key, group_by } = (body ?? {}) as {
    name?: string;
    filters?: { hide_completed?: unknown; assignee?: unknown; status?: unknown };
    sort_key?: string;
    group_by?: string;
  };
  if (!name || String(name).trim() === "") {
    return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
  }
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
      projectId,
      String(name).trim(),
      JSON.stringify(f),
      typeof sort_key === "string" && SORTS.has(sort_key) ? sort_key : "position",
      typeof group_by === "string" && GROUPS.has(group_by) ? group_by : "section",
      uid,
    ],
  );
  await notifyProject(projectId);
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
