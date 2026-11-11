import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
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
  "forms",
]);

export const GET = withProject("view", async (_req, { projectId }) => {
  return NextResponse.json(await getProjectTabs(projectId));
});

export const POST = withProject("configure", async (_req, { uid, projectId, body }) => {
  const { name, view_type } = (body ?? {}) as { name?: string; view_type?: string };
  if (!name || String(name).trim() === "" || !view_type || !VIEW_TYPES.has(view_type)) {
    return NextResponse.json({ error: "name and a valid view_type are required" }, { status: 400 });
  }
  const max = await db.query(
    "SELECT COALESCE(MAX(position), 0) AS position FROM project_tabs WHERE project_id = $1",
    [projectId],
  );
  const key = `custom:${randomUUID()}`;
  const r = await db.query(
    `INSERT INTO project_tabs (project_id, tab_key, name, view_type, position, is_custom, created_by)
     VALUES ($1::bigint, $2, $3, $4, $5, true, $6) RETURNING id`,
    [projectId, key, String(name).trim(), view_type, Number(max.rows[0].position) + 1000, uid],
  );
  await notifyProject(projectId);
  await audit(uid, "project_tab.create", {
    entity: "project_tab",
    entityId: r.rows[0].id,
    projectId,
  });
  return NextResponse.json({ id: r.rows[0].id, tab_key: key }, { status: 201 });
}, { body: true });
