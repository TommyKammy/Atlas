import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";

export async function POST(req: Request) {
  const body = await req.json();
  const { project_id, name } = body;
  if (!project_id || !name || String(name).trim() === "") {
    return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    `INSERT INTO sections (project_id, name, position)
     VALUES ($1, $2, COALESCE((SELECT MAX(position) FROM sections WHERE project_id = $1), 0) + 1000)
     RETURNING id`,
    [project_id, String(name).trim()],
  );
  await notifyProject(project_id);
  await audit(getCurrentUserIdFromRequest(req), "section.create", { entity: "section", entityId: r.rows[0].id, projectId: project_id, summary: String(name).trim() });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
