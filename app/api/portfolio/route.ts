import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";

export const GET = withUser(async (_req, { uid }) => {
  const r = await db.query(
    `SELECT p.id, p.name, pp.added_at::text AS added_at
     FROM portfolio_projects pp JOIN projects p ON p.id = pp.project_id
     WHERE pp.user_id = $1 AND p.archived_at IS NULL ORDER BY pp.added_at DESC`,
    [uid],
  );
  return NextResponse.json(r.rows);
});

export const POST = withUser(async (req, { uid }) => {
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
});

export const DELETE = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const projectId = body?.project_id;
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  await db.query("DELETE FROM portfolio_projects WHERE user_id = $1 AND project_id = $2::bigint", [uid, projectId]);
  return NextResponse.json({ removed: true });
});
