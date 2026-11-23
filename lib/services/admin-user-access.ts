import { withTransaction, type Queryable } from "../db";
import { badRequest, forbidden, notFound } from "../api/errors";
import { canGrantRole, getEffectiveRole, type EffectiveRole, type Permission } from "../permissions";
import { revokeAllUserTokens } from "./mcp-tokens";

type ManagedUserProfile = {
  name: string;
  email: string | null;
  title: string;
  scimEnabled: boolean;
  scimManaged: boolean;
  scimDeleted: boolean;
  scimIdp: string | null;
};

type ManagedUser = {
  actor: EffectiveRole;
  target: EffectiveRole;
  active: boolean;
  profile: ManagedUserProfile;
};

type LockedUser = {
  id: number;
  deactivated_at: string | null;
  name: string;
  email: string | null;
  title: string;
  scim_enabled: boolean;
  scim_managed: boolean;
  scim_deleted: boolean;
  scim_idp: string | null;
};

/**
 * Serialize changes to privileged accounts. Every flow that can promote,
 * demote, deactivate or delete an administrator takes this lock first, then
 * the user rows, so concurrent changes cannot both pass the last-admin check.
 */
export async function lockSuperRoles(q: Queryable) {
  await q.query("SELECT id FROM workspace_roles WHERE is_super ORDER BY id FOR UPDATE");
}

export function withManagedUser<T>(
  actorId: number, targetId: number, permission: Permission,
  change: (q: Queryable, users: ManagedUser) => Promise<T>,
) {
  if (!Number.isSafeInteger(targetId) || targetId <= 0) throw badRequest("invalid user id");
  return withTransaction(async (q) => {
    await lockSuperRoles(q);
    const locked = await q.query(
      `SELECT u.id, u.deactivated_at, u.name, u.email, u.title,
         (si.id IS NOT NULL) AS scim_managed,
         (si.deleted_at IS NOT NULL) AS scim_deleted, si.idp AS scim_idp,
         COALESCE(
           (SELECT scim_enabled FROM workspace_security ORDER BY workspace_id LIMIT 1),
           false
         ) AS scim_enabled
       FROM users u
       LEFT JOIN scim_identities si ON si.user_id = u.id
       WHERE u.id = ANY($1::bigint[]) ORDER BY u.id FOR UPDATE OF u`,
      [[actorId, targetId]],
    );
    const actor = await getEffectiveRole(actorId, q);
    if (actor?.baseLevel !== "admin" || !actor.permissions.has(permission)) throw forbidden();
    const target = await getEffectiveRole(targetId, q, true);
    if (!target) throw notFound();
    if (!canGrantRole(actor, target)) throw forbidden("cannot manage a more privileged account");
    const row = (locked.rows as LockedUser[]).find((u) => u.id === targetId);
    if (!row) throw notFound();
    return change(q, {
      actor,
      target,
      active: row.deactivated_at === null,
      profile: {
        name: row.name,
        email: row.email,
        title: row.title,
        scimEnabled: row.scim_enabled === true,
        scimManaged: row.scim_managed === true,
        scimDeleted: row.scim_deleted === true,
        scimIdp: row.scim_idp,
      },
    });
  });
}

export async function requireAnotherAdmin(q: Queryable, targetId: number, superAdmin: boolean) {
  const other = await q.query(
    `SELECT 1 FROM users u LEFT JOIN workspace_roles r ON r.id = u.role_id
     WHERE u.id <> $1 AND u.deactivated_at IS NULL AND u.is_admin
       AND (NOT $2 OR r.is_super) LIMIT 1`,
    [targetId, superAdmin],
  );
  if (!other.rowCount) throw badRequest("cannot remove the last active administrator of this level");
}

/**
 * A password or two-factor reset invalidates existing sessions and MCP tokens
 * in the caller's transaction. `preserveSessionTokenHash` keeps the acting
 * administrator's own session when they change their own password;
 * `deleteAllSessions` is used by the 2FA reset.
 */
export async function revokeSessionsAndMcpTokens(
  q: Queryable,
  userId: number,
  options: { preserveSessionTokenHash?: string | null; deleteAllSessions?: boolean } = {},
) {
  if (options.deleteAllSessions) {
    await q.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
  } else {
    await q.query(
      "DELETE FROM user_sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2",
      [userId, options.preserveSessionTokenHash ?? null],
    );
  }
  await revokeAllUserTokens(userId, q);
}

/**
 * Apply the admin console's deactivation semantics for any caller: lock in the
 * super-role -> user order, protect the last active administrator at the same
 * level, write deactivated_at, and revoke that user's sessions.
 *
 * The caller supplies an open transaction; callers that are already inside
 * withManagedUser may call this too (Postgres row locks are re-entrant).
 */
export async function setUserDeactivated(
  q: Queryable,
  targetId: number,
  deactivated: boolean,
  options: { preserveSessionTokenHash?: string | null } = {},
) {
  await lockSuperRoles(q);
  const locked = await q.query(
    "SELECT id, deactivated_at FROM users WHERE id = $1::bigint FOR UPDATE",
    [targetId],
  );
  const row = locked.rows[0] as { id: number; deactivated_at: string | null } | undefined;
  if (!row) throw notFound();
  const target = await getEffectiveRole(targetId, q, true);
  if (!target) throw notFound();
  if (deactivated && row.deactivated_at === null && target.baseLevel === "admin") {
    await requireAnotherAdmin(q, targetId, target.isSuper);
  }
  const updated = await q.query(
    `UPDATE users SET deactivated_at = CASE WHEN $2 THEN now() ELSE NULL END
     WHERE id = $1
     RETURNING id, deactivated_at::text AS deactivated_at`,
    [targetId, deactivated],
  );
  if (deactivated) {
    await q.query(
      "DELETE FROM user_sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2",
      [targetId, options.preserveSessionTokenHash ?? null],
    );
    // A disabled account must not keep a working PAT or OAuth token.
    await revokeAllUserTokens(targetId, q);
  }
  return {
    id: targetId,
    deactivated_at: updated.rows[0]?.deactivated_at ?? null,
    wasActive: row.deactivated_at === null,
  };
}
