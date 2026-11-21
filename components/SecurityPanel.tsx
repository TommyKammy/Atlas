"use client";

import { useState } from "react";
import type { AdminRole, SecuritySettings, TotpUserRow } from "@/lib/admin-data";
import { sectionDescriptionClass, sectionTitleClass } from "./ui/form-controls";
import { RbacSection } from "./security/RbacSection";
import { TwoFactorSection } from "./security/TwoFactorSection";
import { SamlSection } from "./security/SamlSection";
import { ScimSection } from "./security/ScimSection";
import { PasswordSection } from "./security/PasswordSection";

type SectionKey = "rbac" | "two-factor" | "saml" | "scim" | "password";

const SECTION_LABEL: Record<SectionKey, string> = {
  rbac: "役割とアクセス",
  "two-factor": "二要素認証",
  saml: "SAML 認証",
  scim: "プロビジョニング（SCIM）",
  password: "パスワード強度",
};

export default function SecurityPanel({
  initialSettings,
  initialRoles,
  initialTotpUsers,
  permissions,
  currentUserId,
  isSuper,
}: {
  initialSettings: SecuritySettings;
  initialRoles: AdminRole[];
  initialTotpUsers: TotpUserRow[];
  permissions: string[];
  currentUserId: number;
  isSuper: boolean;
}) {
  const sections = (["rbac", "two-factor", "saml", "scim", "password"] as const).filter((key) => {
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
      <h2 className={sectionTitleClass}>セキュリティ</h2>
      <p className={sectionDescriptionClass}>
        認証、役割、パスワードのポリシーを管理します。設定はワークスペース全体に適用されます。
      </p>

      <nav aria-label="セキュリティ設定" className="mt-4 flex flex-wrap gap-1">
        {sections.map((key) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            data-security-tab={key}
            aria-current={section === key ? "page" : undefined}
            className={`inline-flex h-8 items-center rounded-md px-3 text-[13px] ${
              section === key
                ? "bg-accent-soft font-medium text-accent-text"
                : "text-secondary hover:bg-hover"
            }`}
          >
            {SECTION_LABEL[key]}
          </button>
        ))}
      </nav>

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
        {section === "scim" && permissions.includes("security.manage") && (
          <ScimSection
            settings={settings}
            onSettings={(next) => updateSettings(next)}
            isSuper={isSuper}
          />
        )}
        {section === "password" && permissions.includes("security.manage") && (
          <PasswordSection settings={settings} onSettings={(next) => updateSettings(next)} />
        )}
      </div>
    </section>
  );
}
