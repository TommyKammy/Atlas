import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { requireProjectPermission } from "@/lib/api-project-auth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(projectId), "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    `SELECT m.id, m.title, m.body, m.created_at::text AS created_at, u.name AS author_name
     FROM project_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.project_id = $1::bigint ORDER BY m.id DESC LIMIT 100`,
    [projectId],
  );
  return NextResponse.json(r.rows);
}

export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json();
  const { project_id, title, body: text } = body;
  if (!project_id || !text || String(text).trim() === "") {
    return NextResponse.json({ error: "project_id and body are required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    "INSERT INTO project_messages (project_id, author_id, title, body) VALUES ($1::bigint, $2, $3, $4) RETURNING id",
    [project_id, uid, String(title ?? "").trim(), String(text).trim()],
  );
  await notifyProject(project_id);
  await audit(getCurrentUserIdFromRequest(req), "message.create", { entity: "message", entityId: r.rows[0].id, projectId: project_id });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
