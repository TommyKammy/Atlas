import { withTransaction, type Queryable } from "../db";
import { badRequest, forbidden, notFound } from "../api/errors";
import { canGrantRole, getEffectiveRole, type EffectiveRole, type Permission } from "../permissions";

type ManagedUser = {
  actor: EffectiveRole;
  target: EffectiveRole;
  active: boolean;
};

export function withManagedUser<T>(
  actorId: number, targetId: number, permission: Permission,
  change: (q: Queryable, users: ManagedUser) => Promise<T>,
) {
  if (!Number.isSafeInteger(targetId) || targetId <= 0) throw badRequest("invalid user id");
  return withTransaction(async (q) => {
    // Serialize changes to privileged accounts, including concurrent demotion and deletion.
    await q.query("SELECT id FROM workspace_roles WHERE is_super ORDER BY id FOR UPDATE");
    const locked = await q.query(
      "SELECT id, deactivated_at FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
      [[actorId, targetId]],
    );
    const actor = await getEffectiveRole(actorId, q);
    if (actor?.baseLevel !== "admin" || !actor.permissions.has(permission)) throw forbidden();
    const target = await getEffectiveRole(targetId, q, true);
    if (!target) throw notFound();
    if (!canGrantRole(actor, target)) throw forbidden("cannot manage a more privileged account");
    const row = locked.rows.find((u) => u.id === targetId);
    return change(q, { actor, target, active: row.deactivated_at === null });
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
