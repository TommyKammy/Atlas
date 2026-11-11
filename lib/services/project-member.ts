import { withTransaction } from "../db";
import { badRequest, forbidden, notFound } from "../api/errors";
import { getProjectPolicyAccess } from "../project-policy-access";
import { canChangeProjectMember } from "../project-policy";
import { normalizeProjectRole, type ProjectRole } from "../project-roles";

/** Serialize all role changes so concurrent requests cannot remove the last admin. */
export async function changeProjectMember(actorId: number, projectId: number, targetId: number, nextRole: ProjectRole | null, add = false) {
  return withTransaction(async (q) => {
    await q.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
    const access = await getProjectPolicyAccess(actorId, projectId, q);
    if (!access.role || !access.canShare) throw forbidden("project sharing is restricted");
    const user = await q.query("SELECT name, is_admin FROM users WHERE id = $1", [targetId]);
    if (!user.rowCount) throw notFound("user not found");
    const current = await q.query("SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2", [projectId, targetId]);
    if (!add && !current.rowCount) throw notFound("member not found");
    const currentRole = normalizeProjectRole(current.rows[0]?.role);
    if (!canChangeProjectMember(access.role, actorId, targetId, currentRole, nextRole, user.rows[0].is_admin === true)) {
      throw forbidden("only project admins can manage admins or their own role");
    }
    if (currentRole === "admin" && nextRole !== "admin") {
      const admins = await q.query("SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'admin'", [projectId]);
      if (admins.rows[0].n <= 1) throw badRequest("cannot remove the last project admin");
    }
    if (nextRole === null) {
      await q.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [projectId, targetId]);
    } else {
      await q.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
        ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [projectId, targetId, nextRole]);
    }
    return { name: user.rows[0].name as string };
  });
}
