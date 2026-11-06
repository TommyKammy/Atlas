import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { normalizeProjectRole } from "@/lib/project-roles";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) return NextResponse.json({ error: "invalid project" }, { status: 400 });
  const auth = await requireProjectPermission(req, projectId, "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin, m.role
     FROM project_members m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1 ORDER BY u.id`,
    [projectId],
  );
  return NextResponse.json({
    members: r.rows.map((row) => ({
      ...row,
      role: normalizeProjectRole(row.role),
    })),
    can_manage: auth.role === "admin",
    current_user_id: auth.uid,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) return NextResponse.json({ error: "invalid project" }, { status: 400 });
  const auth = await requireProjectPermission(req, projectId, "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const userId = Number(body?.user_id);
  const role = normalizeProjectRole(typeof body?.role === "string" ? body.role : "editor");
  if (!Number.isInteger(userId) || userId <= 0 || !role) {
    return NextResponse.json({ error: "user_id and valid role required" }, { status: 400 });
  }
  const user = await db.query("SELECT id, name FROM users WHERE id = $1::bigint", [userId]);
  if (user.rowCount === 0) return NextResponse.json({ error: "user not found" }, { status: 404 });

  await db.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId, userId, role],
  );
  await notifyProject(projectId);
  await audit(auth.uid, "project.member_add", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `${user.rows[0].name} (${role})`,
  });
  return NextResponse.json({ added: userId, role }, { status: 201 });
}
