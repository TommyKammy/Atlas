import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (projectId) {
    const r = await db.query(
      "SELECT id, name FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
      [projectId],
    );
    return NextResponse.json(r.rows);
  }
  const workspaceId = searchParams.get("workspace_id");
  if (workspaceId) {
    const r = await db.query(
      "SELECT id, name FROM projects WHERE workspace_id = $1::bigint ORDER BY id",
      [workspaceId],
    );
    return NextResponse.json(r.rows);
  }
  const all = await db.query("SELECT id, name FROM projects ORDER BY id");
  return NextResponse.json(all.rows);
}
