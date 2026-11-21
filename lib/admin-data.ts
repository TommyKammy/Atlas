import { db } from "./db";
import { canGrantRole, getEffectiveRole, permissionsForBaseLevel, normalizePermissions, type EffectiveRole, type Permission } from "./permissions";
import { isSamlSessionAllowed } from "./session-policy";

export type AdminWorkspace = {
  id: number;
  name: string;
  created_at: string;
  user_count: number;
  project_count: number;
  team_count: number;
};

export type SecuritySettings = {
  workspace_id: number;
  two_factor_policy: "optional" | "required";
  saml_mode: "off" | "optional" | "required" | "members_only";
  saml_signin_url: string;
  saml_certificate: string;
  saml_session_days: number;
  saml_jit_provisioning: boolean;
  scim_enabled: boolean;
  password_min_length: number;
  password_require_upper: boolean;
  password_require_lower: boolean;
  password_require_number: boolean;
  password_require_symbol: boolean;
  updated_at: string;
};

export function requiresSaml(
  mode: SecuritySettings["saml_mode"],
  user: { is_admin: boolean; is_guest: boolean },
): boolean {
  return !isSamlSessionAllowed(mode, { isAdmin: user.is_admin, isGuest: user.is_guest }, "password");
}

export type TeamMember = {
  id: number;
  name: string;
  email: string | null;
  avatar_url: string | null;
  role: "manager" | "member";
};

export type AdminTeam = {
  id: number;
  name: string;
  description: string;
  privacy: "public" | "private" | "approval";
  status: "active" | "approved";
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  members: TeamMember[];
};

export type AdminRole = {
  can_assign?: boolean;
  id: number;
  key: string;
  name: string;
  description: string;
  base_level: "admin" | "member" | "guest";
  permissions: Permission[];
  is_system: boolean;
  is_super: boolean;
  member_count: number;
};

export type AdminUser = {
  can_manage: boolean;
  id: number;
  name: string;
  email?: string | null;
  title?: string | null;
  avatar_url?: string | null;
  is_guest: boolean;
  is_admin?: boolean;
  deactivated_at?: string | null;
  open_tasks?: number;
  role_id?: number | null;
  role_key?: string | null;
  role_name?: string | null;
  totp_enabled?: boolean;
};

type TargetRoleRow = {
  is_admin?: boolean;
  is_guest?: boolean;
  permissions: unknown;
  is_super: boolean | null;
};

async function markManageable<T extends TargetRoleRow>(rows: T[], actorId: number) {
  const actor = await getEffectiveRole(actorId);
  return rows.map(({ permissions, is_super, ...user }) => {
    const legacyLevel = user.is_admin ? "admin" : user.is_guest ? "guest" : "member";
    const list = permissions === null ? permissionsForBaseLevel(legacyLevel) : normalizePermissions(permissions);
    return { ...user, can_manage: canGrantRole(actor, { permissions: new Set(list), isSuper: is_super === true }) };
  });
}

export async function getAdminUsers(actorId: number): Promise<AdminUser[]> {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin,
       u.role_id, u.totp_enabled, u.deactivated_at::text AS deactivated_at,
       r.permissions, r.is_super, r.key AS role_key, r.name AS role_name,
       (SELECT COUNT(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND NOT t.completed) AS open_tasks
     FROM users u
     LEFT JOIN workspace_roles r ON r.id = u.role_id
     ORDER BY u.id`,
  );
  return markManageable(r.rows as (AdminUser & TargetRoleRow)[], actorId);
}

export async function getAdminWorkspace(): Promise<AdminWorkspace | null> {
  const r = await db.query(
    `SELECT w.id, w.name, w.created_at::text AS created_at,
       (SELECT COUNT(*)::int FROM users u WHERE u.deactivated_at IS NULL) AS user_count,
       (SELECT COUNT(*)::int FROM projects p WHERE p.workspace_id = w.id) AS project_count,
       (SELECT COUNT(*)::int FROM teams t WHERE t.workspace_id = w.id) AS team_count
     FROM workspaces w ORDER BY w.id LIMIT 1`,
  );
  return (r.rows[0] as AdminWorkspace | undefined) ?? null;
}

export async function ensureSecuritySettings(workspaceId: number): Promise<SecuritySettings> {
  await db.query(
    "INSERT INTO workspace_security (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING",
    [workspaceId],
  );
  const r = await db.query(
    `SELECT workspace_id, two_factor_policy, saml_mode, saml_signin_url, saml_certificate,
       saml_session_days, saml_jit_provisioning, scim_enabled, password_min_length,
       password_require_upper, password_require_lower, password_require_number,
       password_require_symbol, updated_at::text AS updated_at
     FROM workspace_security WHERE workspace_id = $1`,
    [workspaceId],
  );
  return r.rows[0] as SecuritySettings;
}

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const ws = await db.query("SELECT id FROM workspaces ORDER BY id LIMIT 1");
  const workspaceId = Number(ws.rows[0]?.id ?? 1);
  return ensureSecuritySettings(workspaceId);
}

export async function getAdminTeams(workspaceId: number): Promise<AdminTeam[]> {
  const r = await db.query(
    `SELECT t.id, t.name, t.description, t.privacy, t.status, t.created_by,
       creator.name AS created_by_name, t.created_at::text AS created_at,
       COALESCE(
         json_agg(
           json_build_object(
             'id', u.id,
             'name', u.name,
             'email', u.email,
             'avatar_url', u.avatar_url,
             'role', tm.role
           ) ORDER BY CASE tm.role WHEN 'manager' THEN 0 ELSE 1 END, u.name
         ) FILTER (WHERE u.id IS NOT NULL),
         '[]'::json
       ) AS members
     FROM teams t
     LEFT JOIN users creator ON creator.id = t.created_by
     LEFT JOIN team_members tm ON tm.team_id = t.id
     LEFT JOIN users u ON u.id = tm.user_id AND u.deactivated_at IS NULL
     WHERE t.workspace_id = $1
     GROUP BY t.id, creator.name
     ORDER BY t.id`,
    [workspaceId],
  );
  return r.rows as AdminTeam[];
}

export async function getAdminRoles(workspaceId: number, actor?: EffectiveRole | null): Promise<AdminRole[]> {
  const r = await db.query(
    `SELECT r.id, r.key, r.name, r.description, r.base_level, r.permissions,
       r.is_system, r.is_super,
       (SELECT COUNT(*)::int FROM users u WHERE u.role_id = r.id AND u.deactivated_at IS NULL) AS member_count
     FROM workspace_roles r
     WHERE r.workspace_id = $1
     ORDER BY r.is_super DESC, r.is_system DESC, r.id`,
    [workspaceId],
  );
  const rows = r.rows as (Omit<AdminRole, "permissions"> & { permissions: unknown })[];
  return rows.map((row) => {
    const permissions = normalizePermissions(row.permissions);
    return {
      ...row, permissions,
      ...(actor === undefined ? {} : {
        can_assign: canGrantRole(actor, { isSuper: row.is_super, permissions: new Set(permissions) }),
      }),
    };
  });
}

export type TotpUserRow = {
  can_manage: boolean;
  id: number;
  name: string;
  email: string | null;
  totp_enabled: boolean;
  totp_enrolled_at: string | null;
  role_name: string | null;
};

export async function getTotpUsers(workspaceId: number, actorId: number): Promise<TotpUserRow[]> {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.totp_enabled, u.is_guest, u.is_admin, r.permissions, r.is_super,
       u.totp_enrolled_at::text AS totp_enrolled_at, r.name AS role_name
     FROM users u
     LEFT JOIN workspace_roles r ON r.id = u.role_id
     WHERE u.deactivated_at IS NULL
       AND (u.role_id IS NULL OR r.workspace_id = $1)
     ORDER BY u.totp_enabled DESC, u.id`,
    [workspaceId],
  );
  return markManageable(r.rows as (TotpUserRow & TargetRoleRow)[], actorId);
}
