import { db, type Queryable } from "./db";
import { getProjectAccess } from "./repositories/projects";
import { canConfigureProject, canShareProject } from "./project-policy";

/** Read live policy, including from a caller's transaction, without changing task-role semantics. */
export async function getProjectPolicyAccess(userId: number, projectId: number, q: Queryable = db) {
  const access = await getProjectAccess(userId, projectId, q);
  if (!access.role) return { ...access, canConfigure: false, canShare: false };
  const project = await q.query("SELECT settings FROM projects WHERE id = $1::bigint AND deleted_at IS NULL", [projectId]);
  if (project.rowCount === 0) return { ...access, canConfigure: false, canShare: false };
  const settings = project.rows[0].settings;
  return { ...access, canConfigure: canConfigureProject(access.role, settings), canShare: canShareProject(access.role, settings) };
}
