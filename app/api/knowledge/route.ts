import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(projectId), "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    `SELECT k.id, k.title, k.body, k.created_at::text AS created_at,
            k.updated_at::text AS updated_at, u.name AS author_name
     FROM project_knowledge k LEFT JOIN users u ON u.id = k.author_id
     WHERE k.project_id = $1::bigint ORDER BY k.updated_at DESC, k.id DESC LIMIT 100`,
    [projectId],
  );
  return NextResponse.json(r.rows);
}

export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const { project_id, title, body: text } = body ?? {};
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!title || String(title).trim() === "" || !text || String(text).trim() === "") {
    return NextResponse.json({ error: "title and body are required" }, { status: 400 });
  }
  const r = await db.query(
    `INSERT INTO project_knowledge (project_id, author_id, title, body)
     VALUES ($1::bigint, $2, $3, $4) RETURNING id`,
    [project_id, uid, String(title).trim(), String(text).trim()],
  );
  await notifyProject(Number(project_id));
  await audit(getCurrentUserIdFromRequest(req), "knowledge.create", {
    entity: "knowledge",
    entityId: r.rows[0].id,
    projectId: Number(project_id),
  });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
