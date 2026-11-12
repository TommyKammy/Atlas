import { db, type Queryable } from "./db";
import { getRequestSession } from "./api/session";
import { getProjectAccess } from "./data";
import { getProjectPolicyAccess } from "./project-policy-access";
import {
  canCommentOnProject,
  canEditProject,
  canManageProject,
  canViewProject,
  type ProjectRole,
} from "./project-roles";

export type ProjectPermission = "view" | "comment" | "edit" | "admin" | "configure" | "share";

export type ProjectAuth =
  | { ok: true; uid: number; role: ProjectRole; workspaceAdmin: boolean }
  | { ok: false; status: 403 | 404; error: string };

/** Check a caller's effective project role before a project-scoped mutation. */
export async function requireProjectPermission(
  req: Request,
  projectId: number,
  level: ProjectPermission,
  q: Queryable = db,
): Promise<ProjectAuth> {
  const session = await getRequestSession(req);
  if (!session) return { ok: false, status: 403, error: "unauthenticated" };
  const access = level === "configure" || level === "share"
    ? await getProjectPolicyAccess(session.id, projectId, q)
    : await getProjectAccess(session.id, projectId, q);
  if (!access.role) return { ok: false, status: 403, error: "project access denied" };
  const allowed = level === "configure"
    ? "canConfigure" in access && access.canConfigure
    : level === "share"
      ? "canShare" in access && access.canShare
      : level === "view"
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
export async function getTaskProjectIds(taskIds: number[], q: Queryable = db): Promise<Map<number, number | null>> {
  const unique = [...new Set(taskIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const r = await q.query(
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

export type TaskProjectContext = {
  /** Project that governs legacy single-project behaviour (primary / first / parent). */
  defaultProjectId: number | null;
  /** Primary, explicit memberships, and the parent fallback for projectless tasks. */
  projectIds: number[];
};

/** Default project first, then every other project the task appears in. */
export function orderTaskProjectIds(context: TaskProjectContext): number[] {
  return [
    ...(context.defaultProjectId === null ? [] : [context.defaultProjectId]),
    ...context.projectIds.filter((id) => id !== context.defaultProjectId),
  ];
}

/**
 * Resolve all projects a task belongs to. Multi-homed tasks are editable from
 * any project they appear in, not only from their primary project.
 */
export async function getTaskProjectContext(taskId: number, q: Queryable = db): Promise<TaskProjectContext | null> {
  const r = await q.query(
    `SELECT t.id,
       COALESCE(
         t.project_id,
         (SELECT m.project_id FROM task_project_memberships m WHERE m.task_id = t.id ORDER BY m.project_id LIMIT 1),
         (SELECT p.project_id FROM tasks p WHERE p.id = t.parent_task_id)
       ) AS default_project_id,
       ARRAY(
         SELECT DISTINCT candidate
         FROM (
           SELECT t.project_id AS candidate
           UNION ALL
           SELECT m.project_id FROM task_project_memberships m WHERE m.task_id = t.id
           UNION ALL
           SELECT p.project_id FROM tasks p WHERE p.id = t.parent_task_id AND t.project_id IS NULL
         ) candidates
         WHERE candidate IS NOT NULL
       ) AS project_ids
     FROM tasks t WHERE t.id = $1::bigint`,
    [taskId],
  );
  const row = r.rows[0] as
    | { default_project_id: number | null; project_ids: Array<number | string> | null }
    | undefined;
  if (!row) return null;
  return {
    defaultProjectId:
      row.default_project_id === null || row.default_project_id === undefined
        ? null
        : Number(row.default_project_id),
    projectIds: (row.project_ids ?? []).map((id) => Number(id)).filter((id) => id > 0),
  };
}

/**
 * Authorize a task-scoped operation. By default any project the task belongs to
 * may grant access (multi-home). Pass `scope: "primary"` for destructive
 * operations that should be governed by the task's primary project only.
 * Tasks without a governing project are intentionally fail-closed: only
 * workspace admins may touch them.
 */
export async function requireTaskPermission(
  req: Request,
  taskId: number,
  level: ProjectPermission = "edit",
  options?: { scope?: "any" | "primary"; queryable?: Queryable },
): Promise<TaskAuth> {
  const context = await getTaskProjectContext(taskId, options?.queryable);
  if (!context) return { ok: false, status: 404, error: "task not found" };
  const scope = options?.scope ?? "any";
  const candidates =
    scope === "primary"
      ? context.defaultProjectId === null
        ? []
        : [context.defaultProjectId]
      : orderTaskProjectIds(context);
  if (candidates.length > 0) {
    let lastError: { status: 403 | 404; error: string } = {
      status: 403,
      error: "project access denied",
    };
    for (const projectId of candidates) {
      const auth = await requireProjectPermission(req, projectId, level, options?.queryable);
      if (auth.ok) return { ok: true, uid: auth.uid, projectId };
      lastError = auth;
    }
    return { ok: false, ...lastError };
  }
  const admin = await requireWorkspaceAdmin(req);
  if (!admin.ok) return { ok: false, status: 404, error: "task not found" };
  return { ok: true, uid: admin.uid, projectId: null };
}
