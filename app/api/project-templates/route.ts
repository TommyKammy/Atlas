import { NextResponse } from "next/server";
import { todayISO } from "@/lib/dates";
import { db } from "@/lib/db";
import { withUser, withProject } from "@/lib/api/route";
import { getProjectTemplateSummaries } from "@/lib/repositories/projects";

export const GET = withUser(async (req) => {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspace_id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  const id = Number(workspaceId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid workspace_id" }, { status: 400 });
  }
  return NextResponse.json(await getProjectTemplateSummaries(id));
});

// Snapshot an existing project's structure (sections + top-level tasks with
// due dates rebased as offsets from today) into a reusable template.
export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const { name } = (body ?? {}) as { name?: string };
  if (!name || String(name).trim() === "") {
    return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
  }
  const p = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [projectId]);
  const today = todayISO();
  const sections = await db.query(
    "SELECT id, name FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
    [projectId],
  );
  const payloadSections = [];
  for (const s of sections.rows as { id: number; name: string }[]) {
    const tasks = await db.query(
      `SELECT name, description, assignee_id, due_on::text AS due_on, status
       FROM tasks WHERE project_id = $1::bigint AND section_id = $2::bigint AND parent_task_id IS NULL AND deleted_at IS NULL
       ORDER BY position, id`,
      [projectId, s.id],
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
}, { body: true });
