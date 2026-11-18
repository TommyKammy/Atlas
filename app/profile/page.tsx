import { getUsers } from "@/lib/data";
import { getMfaServerSession } from "@/lib/api/session";
import { redirect } from "next/navigation";
import ProfileForm from "@/components/ProfileForm";
import { getSecuritySettings } from "@/lib/admin-data";
import { passwordPolicySummary } from "@/lib/password-policy";

export const instant = false;

export default async function ProfilePage() {
  const access = await getMfaServerSession();
  if (!access) redirect("/login");
  const me = access.mfaPending ? null : (await getUsers(access.user.id)).find((u) => u.id === access.user.id);
  if (!me && !access.mfaPending) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted">ユーザーがありません。</p>
      </div>
    );
  }
  const security = await getSecuritySettings();
  return (
    <div className="max-w-xl p-6">
      <h1 className="text-lg font-bold">プロフィール</h1>
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
  );
}
