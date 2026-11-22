import {
  authorizeProject,
  authorizeTask,
  type AuthActor,
  type ProjectAuth,
  type ProjectPermission,
  type TaskAuth,
} from "../api-project-auth";
import { forbidden, notFound } from "../api/errors";
import { db, type Queryable } from "../db";
import { hasPermission, type Permission } from "../permissions";

/**
 * Identity for service calls that do not read an HTTP session.
 * `source` and the token fields are carried for auditing; authorization always
 * re-reads the user's live workspace flags instead of trusting the caller.
 */
export type Actor = {
  uid: number;
  source: "web" | "mcp";
  tokenId?: number;
  clientName?: string;
};

export type ProjectAccess = Extract<ProjectAuth, { ok: true }>;
export type TaskAccess = Extract<TaskAuth, { ok: true }>;

/**
 * Resolve the `AuthActor` expected by `lib/api-project-auth.ts` from the
 * current `users` row. Deactivated users and unknown ids resolve to null.
 * Intentionally uncached: role changes and deactivation take effect on the
 * next call.
 */
export async function loadAuthActor(actor: Actor, q: Queryable = db): Promise<AuthActor | null> {
  const r = await q.query(
    `SELECT u.is_admin, u.is_guest, u.deactivated_at
     FROM users u
     WHERE u.id = $1::bigint`,
    [actor.uid],
  );
  const row = r.rows[0] as
    | { is_admin: boolean | null; is_guest: boolean | null; deactivated_at: string | null }
    | undefined;
  if (!row || row.deactivated_at != null) return null;
  return { uid: actor.uid, isAdmin: row.is_admin === true, isGuest: row.is_guest === true };
}

/** Load the live actor or fail closed with the project/task error contract. */
async function requireAuthActor(actor: Actor, q: Queryable): Promise<AuthActor> {
  const authActor = await loadAuthActor(actor, q);
  if (!authActor) throw forbidden("unknown or inactive user");
  return authActor;
}

/**
 * Require a project permission for a session-independent actor.
 * The status and message come from `authorizeProject` unchanged.
 */
export async function requireProjectAccess(
  actor: Actor,
  projectId: number,
  level: ProjectPermission,
  q: Queryable = db,
): Promise<ProjectAccess> {
  const authActor = await requireAuthActor(actor, q);
  const auth = await authorizeProject(authActor, projectId, level, q);
  if (!auth.ok) throw auth.status === 404 ? notFound(auth.error) : forbidden(auth.error);
  return auth;
}

/**
 * Require a task permission for a session-independent actor.
 * Multi-homed tasks accept any project by default; `scope: "primary"` keeps the
 * stricter rule used by destructive operations such as task deletion.
 */
export async function requireTaskAccess(
  actor: Actor,
  taskId: number,
  level: ProjectPermission,
  options?: { scope?: "any" | "primary"; q?: Queryable },
): Promise<TaskAccess> {
  const q = options?.q ?? db;
  const authActor = await requireAuthActor(actor, q);
  const auth = await authorizeTask(authActor, taskId, level, {
    scope: options?.scope,
    queryable: q,
  });
  if (!auth.ok) throw auth.status === 404 ? notFound(auth.error) : forbidden(auth.error);
  return auth;
}

/**
 * Require an RBAC permission (for example `projects.create`).
 * Inactive users have no effective role, so they fail the same way as a member
 * without the permission.
 */
export async function requireWorkspacePermission(actor: Actor, permission: Permission): Promise<void> {
  if (!(await hasPermission(actor.uid, permission))) {
    throw forbidden("permission denied");
  }
}

/**
 * Reject guest users. MCP tokens are never issued to guests, and OAuth/PAT
 * validation must also re-check this on every request.
 */
export async function requireNotGuest(actor: Actor, q: Queryable = db): Promise<void> {
  const authActor = await requireAuthActor(actor, q);
  if (authActor.isGuest) throw forbidden("guest users cannot use MCP");
}
