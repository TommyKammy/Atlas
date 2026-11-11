import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";
import { LIST_GROUP_OPTIONS, LIST_SORT_OPTIONS } from "@/lib/list-view";

const SORTS = new Set<string>(["position", ...LIST_SORT_OPTIONS]);
const GROUPS = new Set<string>(["section", ...LIST_GROUP_OPTIONS]);
const FILTER_TEXT_KEYS = ["assignee", "status", "due", "start", "creator", "created", "updated", "completed_on", "group2", "groupdir", "sortdir"] as const;

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
    filters?: Record<string, unknown>;
    sort_key?: string;
    group_by?: string;
  };
  if (!name || String(name).trim() === "") {
    return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
  }
  const f: Record<string, boolean | string> = {};
  if (filters && typeof filters === "object") {
    if (filters.hide_completed === true) f.hide_completed = true;
    if (filters.completed_only === true) f.completed_only = true;
    if (filters.mine_only === true) f.mine_only = true;
    if (filters.subtasks_collapsed === true) f.subtasks_collapsed = true;
    for (const key of FILTER_TEXT_KEYS) {
      if (typeof filters[key] === "string") f[key] = filters[key];
    }
  }
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
