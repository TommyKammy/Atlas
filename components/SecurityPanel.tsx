"use client";

import { useState } from "react";
import type { AdminRole, SecuritySettings, TotpUserRow } from "@/lib/admin-data";
import { RbacSection } from "./security/RbacSection";
import { TwoFactorSection } from "./security/TwoFactorSection";
import { SamlSection } from "./security/SamlSection";
import { PasswordSection } from "./security/PasswordSection";

type SectionKey = "rbac" | "two-factor" | "saml" | "password";

const SECTION_LABEL: Record<SectionKey, string> = {
  rbac: "役割とアクセス",
  "two-factor": "二要素認証",
  saml: "SAML 認証",
  password: "パスワード強度",
};

export default function SecurityPanel({
  initialSettings,
  initialRoles,
  initialTotpUsers,
  permissions,
  currentUserId,
}: {
  initialSettings: SecuritySettings;
  initialRoles: AdminRole[];
  initialTotpUsers: TotpUserRow[];
  permissions: string[];
  currentUserId: number;
}) {
  const sections = (["rbac", "two-factor", "saml", "password"] as const).filter((key) => {
    if (key === "rbac") return permissions.includes("roles.manage");
    return permissions.includes("security.manage");
  });
  const [section, setSection] = useState<SectionKey>(sections[0] ?? "rbac");
  const [settings, setSettings] = useState(initialSettings);
  const [totpUsers, setTotpUsers] = useState(initialTotpUsers);

  const updateSettings = (next: SecuritySettings, users?: TotpUserRow[]) => {
    setSettings(next);
    if (users) setTotpUsers(users);
  };

  if (sections.length === 0) {
    return <p className="text-sm text-muted">セキュリティ設定を表示する権限がありません。</p>;
  }

  return (
    <section data-admin-panel="security">
      <h2 className="text-base font-semibold">セキュリティ</h2>
      <p className="mt-0.5 text-xs text-muted">
        認証、役割、パスワードのポリシーを管理します。設定はワークスペース全体に適用されます。
      </p>

      <div className="mt-4 flex flex-wrap gap-1 border-b">
        {sections.map((key) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            data-security-tab={key}
            className={`-mb-px rounded-t px-3 py-2 text-sm ${
              section === key
                ? "border-b-2 border-[#4075cf] font-medium text-[#2f5fa8]"
                : "text-muted hover:bg-neutral-50"
            }`}
          >
            {SECTION_LABEL[key]}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {section === "rbac" && permissions.includes("roles.manage") && (
          <RbacSection initialRoles={initialRoles} />
        )}
        {section === "two-factor" && permissions.includes("security.manage") && (
          <TwoFactorSection
            settings={settings}
            totpUsers={totpUsers}
            onSettings={updateSettings}
            currentUserId={currentUserId}
          />
        )}
        {section === "saml" && permissions.includes("security.manage") && (
          <SamlSection settings={settings} onSettings={(next) => updateSettings(next)} />
        )}
        {section === "password" && permissions.includes("security.manage") && (
          <PasswordSection settings={settings} onSettings={(next) => updateSettings(next)} />
        )}
      </div>
    </section>
  );
}
