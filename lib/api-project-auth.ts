import { db, type Queryable } from "./db";
import { getRequestSession, type SessionUser } from "./api/session";
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

/** Identity used by authorization checks that do not read an HTTP session. */
export type AuthActor = { uid: number; isAdmin: boolean; isGuest: boolean };

/** Build an authorization actor from a validated request session. */
export function actorFromSession(session: SessionUser): AuthActor {
  return { uid: session.id, isAdmin: session.isAdmin, isGuest: session.isGuest };
}

/** Resolve the request boundary once; authorization below only needs the actor. */
async function requestActor(req: Request): Promise<AuthActor | null> {
  const session = await getRequestSession(req);
  return session ? actorFromSession(session) : null;
}

/** Check an actor's effective project role before a project-scoped mutation. */
export async function authorizeProject(
  actor: AuthActor,
  projectId: number,
  level: ProjectPermission,
  q: Queryable = db,
): Promise<ProjectAuth> {
  const access = level === "configure" || level === "share"
    ? await getProjectPolicyAccess(actor.uid, projectId, q)
    : await getProjectAccess(actor.uid, projectId, q);
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
  return { ok: true, uid: actor.uid, role: access.role, workspaceAdmin: access.workspaceAdmin };
}

/** Resolve the request's actor and check their effective project role. */
export async function requireProjectPermission(
  req: Request,
  projectId: number,
  level: ProjectPermission,
  q: Queryable = db,
): Promise<ProjectAuth> {
  const actor = await requestActor(req);
  if (!actor) return { ok: false, status: 403, error: "unauthenticated" };
  return authorizeProject(actor, projectId, level, q);
}

/** Require a live (non-deactivated) user session. */
export async function requireActiveUser(
  req: Request,
): Promise<{ ok: true; uid: number } | { ok: false; status: 403; error: string }> {
  const actor = await requestActor(req);
  if (!actor) return { ok: false, status: 403, error: "unknown or inactive user" };
  return { ok: true, uid: actor.uid };
}

/** Check workspace administrator access without reading a request session. */
export function authorizeWorkspaceAdmin(
  actor: AuthActor,
): { ok: true; uid: number } | { ok: false; status: 403; error: string } {
  if (!actor.isAdmin) {
    return { ok: false, status: 403, error: "workspace admin required" };
  }
  return { ok: true, uid: actor.uid };
}

/** Require a workspace administrator (used for shared resources such as bundles/templates). */
export async function requireWorkspaceAdmin(
  req: Request,
): Promise<{ ok: true; uid: number } | { ok: false; status: 403; error: string }> {
  const actor = await requestActor(req);
  if (!actor) {
    return { ok: false, status: 403, error: "workspace admin required" };
  }
  return authorizeWorkspaceAdmin(actor);
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

function taskProjectCandidates(context: TaskProjectContext, scope: "any" | "primary"): number[] {
  return scope === "primary"
    ? context.defaultProjectId === null
      ? []
      : [context.defaultProjectId]
    : orderTaskProjectIds(context);
}

async function authorizeTaskContext(
  actor: AuthActor,
  context: TaskProjectContext,
  level: ProjectPermission,
  scope: "any" | "primary",
  q?: Queryable,
): Promise<TaskAuth> {
  const candidates = taskProjectCandidates(context, scope);
  if (candidates.length > 0) {
    let lastError: { status: 403 | 404; error: string } = {
      status: 403,
      error: "project access denied",
    };
    for (const projectId of candidates) {
      const auth = await authorizeProject(actor, projectId, level, q);
      if (auth.ok) return { ok: true, uid: auth.uid, projectId };
      lastError = auth;
    }
    return { ok: false, ...lastError };
  }
  const admin = authorizeWorkspaceAdmin(actor);
  if (!admin.ok) return { ok: false, status: 404, error: "task not found" };
  return { ok: true, uid: admin.uid, projectId: null };
}

/**
 * Authorize a task-scoped operation. By default any project the task belongs to
 * may grant access (multi-home). Pass `scope: "primary"` for destructive
 * operations that should be governed by the task's primary project only.
 * Tasks without a governing project are intentionally fail-closed: only
 * workspace admins may touch them.
 */
export async function authorizeTask(
  actor: AuthActor,
  taskId: number,
  level: ProjectPermission = "edit",
  options?: { scope?: "any" | "primary"; queryable?: Queryable },
): Promise<TaskAuth> {
  const context = await getTaskProjectContext(taskId, options?.queryable);
  if (!context) return { ok: false, status: 404, error: "task not found" };
  return authorizeTaskContext(actor, context, level, options?.scope ?? "any", options?.queryable);
}

/** Resolve the request's actor once, then apply the same task authorization rules. */
export async function requireTaskPermission(
  req: Request,
  taskId: number,
  level: ProjectPermission = "edit",
  options?: { scope?: "any" | "primary"; queryable?: Queryable },
): Promise<TaskAuth> {
  const context = await getTaskProjectContext(taskId, options?.queryable);
  if (!context) return { ok: false, status: 404, error: "task not found" };
  const scope = options?.scope ?? "any";
  const actor = await requestActor(req);
  if (!actor) {
    // Preserve the existing split: a missing session is 403 for project-backed
    // tasks, while projectless tasks stay hidden as 404 (as the old admin check was).
    return taskProjectCandidates(context, scope).length > 0
      ? { ok: false, status: 403, error: "unauthenticated" }
      : { ok: false, status: 404, error: "task not found" };
  }
  return authorizeTaskContext(actor, context, level, scope, options?.queryable);
}
