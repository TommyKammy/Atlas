import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import AdminConsole from "@/components/AdminConsole";
import {
  getAdminRoles,
  getAdminTeams,
  getAdminWorkspace,
  getSecuritySettings,
  getTotpUsers,
  getAdminUsers,
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
  const users = await getAdminUsers(uid);
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
    getAdminRoles(workspace.id, role),
    getAdminTeams(workspace.id),
    getTotpUsers(workspace.id, uid),
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
