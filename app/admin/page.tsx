import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import AdminConsole from "@/components/AdminConsole";
import {
  getAdminRoles,
  getAdminTeams,
  getAdminWorkspace,
  getSecuritySettings,
  getTotpUsers,
  type AdminUser,
} from "@/lib/admin-data";
import { canAccessAdminConsole, getEffectiveRole } from "@/lib/permissions";
import { getPasswordPolicy, passwordPolicySummary } from "@/lib/password-policy";

export const instant = false;

export default async function AdminPage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const role = await getEffectiveRole(uid);
  if (!canAccessAdminConsole(role)) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold">管理</h1>
        <p className="mt-2 text-sm text-neutral-500">管理者権限が必要です。</p>
      </div>
    );
  }
  const users = (
    await db.query(
      `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin,
         u.role_id, u.totp_enabled, u.deactivated_at::text AS deactivated_at,
         r.key AS role_key, r.name AS role_name,
         (SELECT COUNT(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND NOT t.completed) AS open_tasks
       FROM users u
       LEFT JOIN workspace_roles r ON r.id = u.role_id
       ORDER BY u.id`,
    )
  ).rows as AdminUser[];
  const workspacePromise = getAdminWorkspace();
  const securityPromise = getSecuritySettings();
  const workspace = await workspacePromise;
  if (!workspace) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold">管理</h1>
        <p className="mt-2 text-sm text-neutral-500">ワークスペースが見つかりません。</p>
      </div>
    );
  }
  const security = await securityPromise;
  const passwordPolicyText = passwordPolicySummary(await getPasswordPolicy());
  const [roles, teams, totpUsers] = await Promise.all([
    getAdminRoles(workspace.id),
    getAdminTeams(workspace.id),
    getTotpUsers(workspace.id),
  ]);
  return (
    <div className="max-w-6xl p-6">
      <h1 className="text-lg font-bold">管理</h1>
      <p className="mt-0.5 text-xs text-neutral-500">
        {workspace.name} のメンバー、チーム、セキュリティを管理します。
      </p>
      <AdminConsole
        currentUserId={uid}
        initialUsers={users}
        initialRoles={roles}
        initialTeams={teams}
        initialWorkspace={workspace}
        initialSecurity={security}
        initialTotpUsers={totpUsers}
        permissions={[...(role?.permissions ?? [])]}
        passwordPolicyText={passwordPolicyText}
      />
    </div>
  );
}
