import { db } from "./db";
import {
  ALL_PERMISSIONS,
  normalizePermissions,
  type Permission,
} from "./permission-catalog";

export {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  isPermission,
  normalizePermissions,
  type Permission,
} from "./permission-catalog";

const MEMBER_PERMISSIONS: Permission[] = ["projects.create", "tasks.create"];
const ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => p !== "roles.manage");
const SUPER_ADMIN_PERMISSIONS: Permission[] = [...ALL_PERMISSIONS];

export function permissionsForBaseLevel(baseLevel: string, superAdmin = false): Permission[] {
  if (baseLevel === "admin") return superAdmin ? SUPER_ADMIN_PERMISSIONS : ADMIN_PERMISSIONS;
  if (baseLevel === "guest") return [];
  return MEMBER_PERMISSIONS;
}

export type EffectiveRole = {
  roleId: number | null;
  roleKey: string;
  roleName: string;
  baseLevel: "admin" | "member" | "guest";
  isSuper: boolean;
  permissions: Set<string>;
};

/**
 * Resolve a user's effective workspace role. Legacy users without role_id
 * fall back to the is_admin / is_guest flags so existing data keeps working.
 */
export async function getEffectiveRole(userId: number): Promise<EffectiveRole | null> {
  const r = await db.query(
    `SELECT u.id, u.is_admin, u.is_guest, u.role_id,
       r.key, r.name, r.base_level, r.permissions, r.is_super
     FROM users u LEFT JOIN workspace_roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.deactivated_at IS NULL`,
    [userId],
  );
  const row = r.rows[0] as
    | {
        id: number;
        is_admin: boolean;
        is_guest: boolean;
        role_id: number | null;
        key: string | null;
        name: string | null;
        base_level: string | null;
        permissions: unknown;
        is_super: boolean | null;
      }
    | undefined;
  if (!row) return null;
  if (row.role_id && row.key && row.base_level) {
    return {
      roleId: Number(row.role_id),
      roleKey: row.key,
      roleName: row.name ?? row.key,
      baseLevel: row.base_level as EffectiveRole["baseLevel"],
      isSuper: row.is_super === true,
      permissions: new Set(normalizePermissions(row.permissions)),
    };
  }
  const baseLevel = row.is_admin ? "admin" : row.is_guest ? "guest" : "member";
  return {
    roleId: null,
    roleKey: baseLevel === "admin" ? "admin" : baseLevel === "guest" ? "guest" : "member",
    roleName: baseLevel === "admin" ? "管理者" : baseLevel === "guest" ? "ゲスト" : "メンバー",
    baseLevel,
    isSuper: false,
    permissions: new Set(permissionsForBaseLevel(baseLevel)),
  };
}

export async function hasPermission(userId: number, permission: Permission): Promise<boolean> {
  const role = await getEffectiveRole(userId);
  return role?.permissions.has(permission) === true;
}

export type RoleRecord = {
  id: number;
  key: string;
  name: string;
  baseLevel: "admin" | "member" | "guest";
  isGuest: boolean;
  isAdmin: boolean;
  permissions: Set<string>;
};

export async function getRoleByKey(key: string): Promise<RoleRecord | null> {
  const r = await db.query(
    `SELECT id, key, name, base_level, permissions FROM workspace_roles
     WHERE key = $1 ORDER BY workspace_id LIMIT 1`,
    [key],
  );
  const row = r.rows[0] as
    | {
        id: number;
        key: string;
        name: string;
        base_level: "admin" | "member" | "guest";
        permissions: unknown;
      }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    key: row.key,
    name: row.name,
    baseLevel: row.base_level,
    isAdmin: row.base_level === "admin",
    isGuest: row.base_level === "guest",
    permissions: new Set(normalizePermissions(row.permissions)),
  };
}

export async function getDefaultRole(): Promise<RoleRecord | null> {
  return getRoleByKey("member");
}

export function canAccessAdminConsole(role: EffectiveRole | null): boolean {
  if (!role || role.baseLevel !== "admin") return false;
  return role.permissions.size > 0 || role.isSuper;
}

/** A user can only grant a role whose permissions are a subset of their own. */
export function canGrantRole(actor: EffectiveRole | null, role: RoleRecord): boolean {
  if (!actor) return false;
  for (const permission of role.permissions) {
    if (!actor.permissions.has(permission)) return false;
  }
  return true;
}
