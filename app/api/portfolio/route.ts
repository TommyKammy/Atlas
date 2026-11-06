import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";

async function currentUser(req: Request) {
  return getCurrentUserIdFromRequest(req);
}

export async function GET(req: Request) {
  const uid = await currentUser(req);
  if (uid === null) return NextResponse.json([]);
  const r = await db.query(
    `SELECT p.id, p.name, pp.added_at::text AS added_at
     FROM portfolio_projects pp JOIN projects p ON p.id = pp.project_id
     WHERE pp.user_id = $1 AND p.archived_at IS NULL ORDER BY pp.added_at DESC`,
    [uid],
  );
  return NextResponse.json(r.rows);
}

export async function POST(req: Request) {
  const uid = await currentUser(req);
  if (uid === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const projectId = body?.project_id;
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  const p = await db.query("SELECT id FROM projects WHERE id = $1::bigint AND archived_at IS NULL", [projectId]);
  if (p.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.query(
    "INSERT INTO portfolio_projects (user_id, project_id) VALUES ($1, $2::bigint) ON CONFLICT DO NOTHING",
    [uid, projectId],
  );
  return NextResponse.json({ added: true });
}

export async function DELETE(req: Request) {
  const uid = await currentUser(req);
  if (uid === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const projectId = body?.project_id;
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  await db.query("DELETE FROM portfolio_projects WHERE user_id = $1 AND project_id = $2::bigint", [uid, projectId]);
  return NextResponse.json({ removed: true });
}
