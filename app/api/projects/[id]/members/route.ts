import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";
import { getProjectPolicyAccess } from "@/lib/project-policy-access";
import { changeProjectMember } from "@/lib/services/project-member";
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
    can_manage: (await getProjectPolicyAccess(uid, projectId)).canShare,
    can_manage_admins: role === "admin",
    current_user_id: uid,
  });
});

export const POST = withProject("share", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { user_id?: unknown; role?: unknown };
  const userId = Number(payload.user_id);
  const nextRole = normalizeProjectRole(typeof payload.role === "string" ? payload.role : "editor");
  if (!Number.isInteger(userId) || userId <= 0 || !nextRole) {
    return NextResponse.json({ error: "user_id and valid role required" }, { status: 400 });
  }
  const user = await changeProjectMember(uid, projectId, userId, nextRole, true);
  await notifyProject(projectId);
  await audit(uid, "project.member_add", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `${user.name} (${nextRole})`,
  });
  return NextResponse.json({ added: userId, role: nextRole }, { status: 201 });
}, { body: true });
