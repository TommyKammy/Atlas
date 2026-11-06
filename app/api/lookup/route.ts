import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (projectId) {
    const auth = await requireProjectPermission(req, Number(projectId), "view");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const r = await db.query(
      "SELECT id, name FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
      [projectId],
    );
    return NextResponse.json(r.rows);
  }
  const uid = getCurrentUserIdFromRequest(req);
  const workspaceId = searchParams.get("workspace_id");
  const params: unknown[] = [uid];
  let where = "";
  if (workspaceId) {
    params.push(Number(workspaceId));
    where = ` AND p.workspace_id = $${params.length}::bigint`;
  }
  const r = await db.query(
    `SELECT p.id, p.name FROM projects p
     WHERE (EXISTS (SELECT 1 FROM users u WHERE u.id = $1 AND u.is_admin AND u.deactivated_at IS NULL)
       OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1))${where}
     ORDER BY p.id`,
    params,
  );
  return NextResponse.json(r.rows);
}
