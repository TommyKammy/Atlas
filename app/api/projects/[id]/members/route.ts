import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";
import { normalizeProjectRole } from "@/lib/project-roles";

export const GET = withProject("view", async (_req, { projectId, role, uid }) => {
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
    can_manage: role === "admin",
    current_user_id: uid,
  });
});

export const POST = withProject("admin", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { user_id?: unknown; role?: unknown };
  const userId = Number(payload.user_id);
  const nextRole = normalizeProjectRole(typeof payload.role === "string" ? payload.role : "editor");
  if (!Number.isInteger(userId) || userId <= 0 || !nextRole) {
    return NextResponse.json({ error: "user_id and valid role required" }, { status: 400 });
  }
  const user = await db.query("SELECT id, name FROM users WHERE id = $1::bigint", [userId]);
  if (user.rowCount === 0) return NextResponse.json({ error: "user not found" }, { status: 404 });

  await db.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId, userId, nextRole],
  );
  await notifyProject(projectId);
  await audit(uid, "project.member_add", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `${user.rows[0].name} (${nextRole})`,
  });
  return NextResponse.json({ added: userId, role: nextRole }, { status: 201 });
}, { body: true });
