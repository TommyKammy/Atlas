import { getUsers } from "@/lib/data";
import { getMfaServerSession } from "@/lib/api/session";
import { redirect } from "next/navigation";
import ProfileForm from "@/components/ProfileForm";
import { getSecuritySettings } from "@/lib/admin-data";
import { passwordPolicySummary } from "@/lib/password-policy";
import { pageDescriptionClass, pageShellClass, pageTitleClass } from "@/components/ui/page-layout";

export const instant = false;

export default async function ProfilePage() {
  const access = await getMfaServerSession();
  if (!access) redirect("/login");
  const me = access.mfaPending ? null : (await getUsers(access.user.id)).find((u) => u.id === access.user.id);
  if (!me && !access.mfaPending) {
    return (
      <div className={pageShellClass}>
        <div className="max-w-xl">
          <h1 className={pageTitleClass}>プロフィール</h1>
          <p className={pageDescriptionClass}>ユーザーがありません。</p>
        </div>
      </div>
    );
  }
  const security = await getSecuritySettings();
  return (
    <div className={pageShellClass}>
      <div className="max-w-xl">
        <h1 className={pageTitleClass}>プロフィール</h1>
        <p className={pageDescriptionClass}>アカウント情報とサインインの設定を管理します。</p>
        <div id="settings">
          <ProfileForm
            userId={access.user.id}
            initialName={me?.name ?? ""}
            initialEmail={me?.email ?? ""}
            initialTitle={me?.title ?? ""}
            initialAvatarUrl={me?.avatar_url ?? ""}
            isGuest={access.user.isGuest}
            initialTotpEnabled={access.mfaEnabled}
            mfaPending={access.mfaPending}
            twoFactorPolicy={security.two_factor_policy}
            passwordMinLength={security.password_min_length}
            passwordPolicyText={passwordPolicySummary({
              min_length: security.password_min_length,
              require_upper: security.password_require_upper,
              require_lower: security.password_require_lower,
              require_number: security.password_require_number,
              require_symbol: security.password_require_symbol,
            })}
          />
        </div>
      </div>
    </div>
  );
}
