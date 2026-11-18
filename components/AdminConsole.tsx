"use client";

import { useEffect, useState } from "react";
import type {
  AdminRole,
  AdminTeam,
  AdminUser,
  AdminWorkspace,
  SecuritySettings,
  TotpUserRow,
} from "@/lib/admin-data";
import AdminPanel from "./AdminPanel";
import TeamsPanel from "./TeamsPanel";
import OrganizationPanel from "./OrganizationPanel";
import SecurityPanel from "./SecurityPanel";
import UsageStats from "./UsageStats";
import LlmSettings from "./LlmSettings";

type TabKey = "members" | "teams" | "workspace" | "security" | "insights" | "ai";

type Tab = {
  key: TabKey;
  label: string;
  description: string;
  allowed: boolean;
};

export default function AdminConsole({
  currentUserId,
  initialUsers,
  initialRoles,
  initialTeams,
  initialWorkspace,
  initialSecurity,
  initialTotpUsers,
  permissions,
  passwordPolicyText,
}: {
  currentUserId: number;
  initialUsers: AdminUser[];
  initialRoles: AdminRole[];
  initialTeams: AdminTeam[];
  initialWorkspace: AdminWorkspace;
  initialSecurity: SecuritySettings;
  initialTotpUsers: TotpUserRow[];
  permissions: string[];
  passwordPolicyText: string;
}) {
  const tabs: Tab[] = [
    {
      key: "members",
      label: "メンバー",
      description: "ユーザー、招待、権限",
      allowed: permissions.includes("members.manage"),
    },
    {
      key: "teams",
      label: "チーム",
      description: "チームとメンバー",
      allowed: permissions.includes("teams.manage"),
    },
    {
      key: "workspace",
      label: "組織設定",
      description: "組織名とプロフィール",
      allowed: permissions.includes("workspace.manage"),
    },
    {
      key: "security",
      label: "セキュリティ",
      description: "RBAC、2FA、SAML、パスワード",
      allowed: permissions.includes("security.manage") || permissions.includes("roles.manage"),
    },
    {
      key: "insights",
      label: "利用状況",
      description: "統計と監査",
      allowed: permissions.includes("insights.view"),
    },
    { key: "ai", label: "AI接続", description: "ノートの要約と文章改善", allowed: permissions.includes("workspace.manage") },
  ];
  const visible = tabs.filter((tab) => tab.allowed);
  const [active, setActive] = useState<TabKey>(visible[0]?.key ?? "members");
  const rolesKey = initialRoles.map((role) => `${role.id}:${role.name}`).join("|");

  const visibleKey = visible.map((tab) => tab.key).join(",");
  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash.replace("#", "");
      const match = visible.find((tab) => tab.key === hash);
      if (match) setActive(match.key);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  const select = (key: TabKey) => {
    setActive(key);
    if (window.location.hash !== `#${key}`) {
      history.replaceState(null, "", `${window.location.pathname}#${key}`);
    }
  };

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-line p-6 text-sm text-muted">
        管理コンソールを表示する権限がありません。
      </div>
    );
  }

  return (
    <div data-admin-console className="mt-4 flex flex-col gap-5 md:flex-row">
      <aside className="shrink-0 md:w-56">
        <div className="rounded-lg border border-line bg-surface p-2">
          <div className="px-2 pb-1 pt-1 text-[11px] font-medium tracking-wide text-muted">
            {initialWorkspace.name}
          </div>
          <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {visible.map((tab) => (
              <button
                key={tab.key}
                onClick={() => select(tab.key)}
                data-admin-tab={tab.key}
                aria-current={active === tab.key ? "page" : undefined}
                className={`min-w-[110px] rounded-md px-2 py-2 text-left text-sm md:min-w-0 ${
                  active === tab.key
                    ? "bg-accent-soft font-medium text-accent-text"
                    : "text-secondary hover:bg-hover"
                }`}
              >
                <span className="block whitespace-nowrap">{tab.label}</span>
                <span className="mt-0.5 hidden text-[10px] font-normal text-muted md:block">
                  {tab.description}
                </span>
              </button>
            ))}
          </nav>
        </div>
        {permissions.includes("audit.view") && (
          <div className="mt-2 hidden rounded-lg border border-line p-2 md:block">
            <a
              href="/audit"
              className="block rounded px-2 py-1.5 text-xs text-secondary hover:bg-hover"
            >
              監査ログを開く →
            </a>
            <a
              href="/api/admin/audit/export?format=csv"
              className="mt-1 block rounded px-2 py-1.5 text-xs text-secondary hover:bg-hover"
            >
              CSV をエクスポート
            </a>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        {active === "members" && permissions.includes("members.manage") && (
          <div data-admin-panel="members">
            <h2 className="text-base font-semibold">メンバー</h2>
            <p className="mt-0.5 text-xs text-muted">
              ユーザーの追加、編集、無効化、ロールの割り当て、招待を管理します。
            </p>
            <AdminPanel
              key={rolesKey}
              initial={initialUsers}
              currentUserId={currentUserId}
              roles={initialRoles}
              passwordPolicyText={passwordPolicyText}
            />
          </div>
        )}
        {active === "teams" && permissions.includes("teams.manage") && (
          <TeamsPanel initialTeams={initialTeams} users={initialUsers} />
        )}
        {active === "ai" && permissions.includes("workspace.manage") && <LlmSettings />}
        {active === "workspace" && permissions.includes("workspace.manage") && (
          <OrganizationPanel initial={initialWorkspace} />
        )}
        {active === "security" &&
          (permissions.includes("security.manage") || permissions.includes("roles.manage")) && (
            <SecurityPanel
              initialSettings={initialSecurity}
              initialRoles={initialRoles}
              initialTotpUsers={initialTotpUsers}
              permissions={permissions}
              currentUserId={currentUserId}
            />
          )}
        {active === "insights" && permissions.includes("insights.view") && (
          <section data-admin-panel="insights">
            <h2 className="text-base font-semibold">利用状況</h2>
            <p className="mt-0.5 text-xs text-muted">
              直近 2 週間のタスク・コメントの作成数とアクティブユーザーを表示します。
            </p>
            <UsageStats />
          </section>
        )}
      </div>
    </div>
  );
}
