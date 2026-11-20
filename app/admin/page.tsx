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
import {
  pageContentInsetClass,
  pageDescriptionClass,
  pageFixedClass,
  pageFrameClass,
  pageHeaderInsetClass,
  pageScrollClass,
  pageTitleClass,
} from "@/components/ui/page-layout";

export const instant = false;

export default async function AdminPage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const role = await getEffectiveRole(uid);
  if (!canAccessAdminConsole(role)) {
    return (
      <div className={pageFrameClass}>
        <div data-page-fixed className={`${pageFixedClass} ${pageHeaderInsetClass}`}>
        <div className="max-w-5xl">
          <h1 className={pageTitleClass}>管理</h1>
          <p className={pageDescriptionClass}>管理者権限が必要です。</p>
        </div>
        </div>
      </div>
    );
  }
  const users = await getAdminUsers(uid);
  const workspacePromise = getAdminWorkspace();
  const securityPromise = getSecuritySettings();
  const workspace = await workspacePromise;
  if (!workspace) {
    return (
      <div className={pageFrameClass}>
        <div data-page-fixed className={`${pageFixedClass} ${pageHeaderInsetClass}`}>
        <div className="max-w-5xl">
          <h1 className={pageTitleClass}>管理</h1>
          <p className={pageDescriptionClass}>ワークスペースが見つかりません。</p>
        </div>
        </div>
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
    <div className={pageFrameClass}>
      <div data-page-fixed className={`${pageFixedClass} ${pageHeaderInsetClass}`}>
      <div className="max-w-6xl">
        <h1 className={pageTitleClass}>管理</h1>
        <p className={pageDescriptionClass}>
          {workspace.name} のメンバー、チーム、セキュリティを管理します。
        </p>
      </div>
      </div>
      <div data-page-scroll className={`${pageScrollClass} ${pageContentInsetClass}`}>
      <div className="max-w-6xl">
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
      </div>
    </div>
  );
}
