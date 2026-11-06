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

/** Require a live (non-deactivated) user session. */
export async function requireActiveUser(
  req: Request,
): Promise<{ ok: true; uid: number } | { ok: false; status: 403; error: string }> {
  const uid = getCurrentUserIdFromRequest(req);
  const r = await db.query("SELECT id FROM users WHERE id = $1 AND deactivated_at IS NULL", [uid]);
  if ((r.rowCount ?? 0) === 0) return { ok: false, status: 403, error: "unknown or inactive user" };
  return { ok: true, uid };
}

/** Require a workspace administrator (used for shared resources such as bundles/templates). */
export async function requireWorkspaceAdmin(
  req: Request,
): Promise<{ ok: true; uid: number } | { ok: false; status: 403; error: string }> {
  const uid = getCurrentUserIdFromRequest(req);
  const r = await db.query("SELECT is_admin, deactivated_at FROM users WHERE id = $1", [uid]);
  if ((r.rowCount ?? 0) === 0 || r.rows[0].deactivated_at !== null || r.rows[0].is_admin !== true) {
    return { ok: false, status: 403, error: "workspace admin required" };
  }
  return { ok: true, uid };
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
