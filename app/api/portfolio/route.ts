import { projectDataAccess } from "@/lib/data-actor";
import { getPortfolioProjects } from "@/lib/data";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";

export const GET = withUser(async (_req, { uid }) => {
  return NextResponse.json(await getPortfolioProjects(uid));
});

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const projectId = body?.project_id;
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  const allowed = await db.query(
    `WITH visible AS (
       SELECT p.id FROM projects p WHERE p.id = $2::bigint AND p.archived_at IS NULL
         AND p.deleted_at IS NULL AND ${projectDataAccess("p", "$1")}
     ), saved AS (
       INSERT INTO portfolio_projects (user_id, project_id)
       SELECT $1, id FROM visible ON CONFLICT DO NOTHING
     ) SELECT id FROM visible`,
    [uid, projectId],
  );
  if (!allowed.rowCount) return NextResponse.json({ error: "not found" }, { status: 404 });
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
