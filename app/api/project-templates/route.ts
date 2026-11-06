import { NextResponse } from "next/server";
import { todayISO } from "@/lib/dates";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyProject } from "@/lib/notify";
import { requireActiveUser, requireProjectPermission } from "@/lib/api-project-auth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspace_id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  const active = await requireActiveUser(req);
  if (!active.ok) return NextResponse.json({ error: active.error }, { status: active.status });
  const r = await db.query(
    "SELECT id, name FROM project_templates WHERE workspace_id = $1::bigint ORDER BY id",
    [workspaceId],
  );
  return NextResponse.json(r.rows);
}

// Snapshot an existing project's structure (sections + top-level tasks with
// due dates rebased as offsets from today) into a reusable template.
export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const { project_id, name } = body ?? {};
  if (!project_id || !name || String(name).trim() === "") {
    return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const p = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [project_id]);
  if (p.rowCount === 0) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const today = todayISO();
  const sections = await db.query(
    "SELECT id, name FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
    [project_id],
  );
  const payloadSections = [];
  for (const s of sections.rows as { id: number; name: string }[]) {
    const tasks = await db.query(
      `SELECT name, description, assignee_id, due_on::text AS due_on, status
       FROM tasks WHERE project_id = $1::bigint AND section_id = $2::bigint AND parent_task_id IS NULL AND deleted_at IS NULL
       ORDER BY position, id`,
      [project_id, s.id],
    );
    payloadSections.push({
      name: s.name,
      tasks: (tasks.rows as { name: string; description: string; assignee_id: number | null; due_on: string | null; status: string }[]).map(
        (t) => ({
          name: t.name,
          description: t.description,
          assignee_id: t.assignee_id,
          due_offset_days:
            t.due_on === null
              ? null
              : Math.round((Date.parse(`${t.due_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000),
          status: t.status,
        }),
      ),
    });
  }
  const r = await db.query(
    "INSERT INTO project_templates (workspace_id, name, payload, created_by) VALUES ($1, $2, $3::jsonb, $4) RETURNING id",
    [p.rows[0].workspace_id, String(name).trim(), JSON.stringify({ sections: payloadSections }), uid],
  );
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
