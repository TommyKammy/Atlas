import { db } from "./db";
import { getRequestSession } from "./api/session";
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
  const session = await getRequestSession(req);
  if (!session) return { ok: false, status: 403, error: "unauthenticated" };
  const access = await getProjectAccess(session.id, projectId);
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
  return { ok: true, uid: session.id, role: access.role, workspaceAdmin: access.workspaceAdmin };
}

/** Require a live (non-deactivated) user session. */
export async function requireActiveUser(
  req: Request,
): Promise<{ ok: true; uid: number } | { ok: false; status: 403; error: string }> {
  const session = await getRequestSession(req);
  if (!session) return { ok: false, status: 403, error: "unknown or inactive user" };
  return { ok: true, uid: session.id };
}

/** Require a workspace administrator (used for shared resources such as bundles/templates). */
export async function requireWorkspaceAdmin(
  req: Request,
): Promise<{ ok: true; uid: number } | { ok: false; status: 403; error: string }> {
  const session = await getRequestSession(req);
  if (!session || !session.isAdmin) {
    return { ok: false, status: 403, error: "workspace admin required" };
  }
  return { ok: true, uid: session.id };
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

/** Resolve the governing project for many tasks in one query. */
export async function getTaskProjectIds(taskIds: number[]): Promise<Map<number, number | null>> {
  const unique = [...new Set(taskIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const r = await db.query(
    `SELECT t.id,
       COALESCE(
         t.project_id,
         (SELECT m.project_id FROM task_project_memberships m WHERE m.task_id = t.id ORDER BY m.project_id LIMIT 1),
         (SELECT p.project_id FROM tasks p WHERE p.id = t.parent_task_id)
       ) AS project_id
     FROM tasks t WHERE t.id = ANY($1::bigint[])`,
    [unique],
  );
  return new Map(
    r.rows.map((row) => [
      Number(row.id),
      row.project_id === null || row.project_id === undefined ? null : Number(row.project_id),
    ]),
  );
}

export type TaskAuth =
  | { ok: true; uid: number; projectId: number | null }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Authorize a task-scoped operation. Tasks without a governing project are
 * intentionally fail-closed: only workspace admins may touch them.
 */
export async function requireTaskPermission(
  req: Request,
  taskId: number,
  level: ProjectPermission = "edit",
): Promise<TaskAuth> {
  const projects = await getTaskProjectIds([taskId]);
  if (!projects.has(taskId)) return { ok: false, status: 404, error: "task not found" };
  const projectId = projects.get(taskId) ?? null;
  if (projectId !== null) {
    const auth = await requireProjectPermission(req, projectId, level);
    if (!auth.ok) return auth;
    return { ok: true, uid: auth.uid, projectId };
  }
  const admin = await requireWorkspaceAdmin(req);
  if (!admin.ok) return { ok: false, status: 404, error: "task not found" };
  return { ok: true, uid: admin.uid, projectId: null };
}
