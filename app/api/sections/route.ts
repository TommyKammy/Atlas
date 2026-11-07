import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const { name } = (body ?? {}) as { name?: string };
  if (!name || String(name).trim() === "") {
    return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
  }
  const r = await db.query(
    `INSERT INTO sections (project_id, name, position)
     VALUES ($1, $2, COALESCE((SELECT MAX(position) FROM sections WHERE project_id = $1), 0) + 1000)
     RETURNING id`,
    [projectId, String(name).trim()],
  );
  await notifyProject(projectId);
  await audit(uid, "section.create", { entity: "section", entityId: r.rows[0].id, projectId, summary: String(name).trim() });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
