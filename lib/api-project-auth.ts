import { db } from "./db";
import { getCurrentUserIdFromRequest } from "./current-user";
import { getProjectAccess } from "./data";
import {
  canCommentOnProject,
  canEditProject,
  canManageProject,
  canViewProject,
  type ProjectRole,
} from "./project-roles";

export type ProjectPermission = "view" | "comment" | "edit" | "admin";

export type ProjectAuth =
  | { ok: true; uid: number; role: ProjectRole; workspaceAdmin: boolean }
  | { ok: false; status: 403 | 404; error: string };

/** Check a caller's effective project role before a project-scoped mutation. */
export async function requireProjectPermission(
  req: Request,
  projectId: number,
  level: ProjectPermission,
): Promise<ProjectAuth> {
  const uid = getCurrentUserIdFromRequest(req);
  const access = await getProjectAccess(uid, projectId);
  if (!access.role) return { ok: false, status: 403, error: "project access denied" };
  const allowed =
    level === "view"
      ? canViewProject(access.role)
      : level === "comment"
        ? canCommentOnProject(access.role)
        : level === "edit"
          ? canEditProject(access.role)
          : canManageProject(access.role);
  if (!allowed) return { ok: false, status: 403, error: "insufficient project role" };
  return { ok: true, uid, role: access.role, workspaceAdmin: access.workspaceAdmin };
}

/** Resolve the project that should govern a task (primary, multi-home, or parent). */
export async function getTaskProjectId(taskId: number): Promise<number | null> {
  const r = await db.query(
    `SELECT COALESCE(
       t.project_id,
       (SELECT m.project_id FROM task_project_memberships m WHERE m.task_id = t.id ORDER BY m.project_id LIMIT 1),
       (SELECT p.project_id FROM tasks p WHERE p.id = t.parent_task_id)
     ) AS project_id
     FROM tasks t WHERE t.id = $1::bigint`,
    [taskId],
  );
  return (r.rows[0]?.project_id as number | null | undefined) ?? null;
}
