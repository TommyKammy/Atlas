"use client";

import { authenticationFailureMessage } from "@/lib/auth-client-feedback";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { scimIdpLabel } from "@/lib/scim/log";
import type { ScimUserState } from "@/lib/scim/managed-user";
import {
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  pillClass,
  pillSuccessClass,
  primaryButtonClass,
  smallDangerButtonClass,
} from "./ui/form-controls";
import UserAvatar from "./UserAvatar";

type TotpSetup = {
  secret: string;
  otpauth_uri: string;
  qr_data_url: string;
};

const sectionClass = "py-6 first:pt-2";
const sectionHeadingClass = "text-[16px] font-semibold leading-6 text-text";
const sectionDescriptionClass = "mt-1 text-[13px] leading-5 text-muted";

export default function ProfileForm({
  userId,
  initialName,
  initialEmail,
  initialTitle,
  initialAvatarUrl,
  isGuest,
  initialTotpEnabled,
  mfaPending,
  scimState,
  scimIdp,
  twoFactorPolicy,
  passwordMinLength,
  passwordPolicyText,
}: {
  userId: number;
  initialName: string;
  initialEmail: string;
  initialTitle: string;
  initialAvatarUrl: string;
  isGuest: boolean;
  initialTotpEnabled: boolean;
  mfaPending: boolean;
  scimState: ScimUserState;
  scimIdp: string | null;
  twoFactorPolicy: "optional" | "required";
  passwordMinLength: number;
  passwordPolicyText: string;
}) {
  const router = useRouter();
  const scimManaged = scimState === "active";
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [title, setTitle] = useState(initialTitle);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [msg, setMsg] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(initialTotpEnabled);
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [twoFaMsg, setTwoFaMsg] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const saveProfile = async () => {
    setMsg("");
    if (!scimManaged) {
      if (!name.trim()) {
        setMsg("名前を入力してください");
        return;
      }
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setMsg("有効なメールアドレスを入力してください");
        return;
      }
    }
    const profile: Record<string, unknown> = { avatar_url: avatarUrl };
    if (!scimManaged) {
      profile.name = name;
      profile.email = email;
      profile.title = title;
    }
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setMsg("プロフィールを更新しました");
      if (typeof data?.avatar_url === "string") setAvatarUrl(data.avatar_url);
      router.refresh();
    } else {
      setMsg(authenticationFailureMessage(res) ?? `更新に失敗しました: ${data?.error ?? res.status}`);
    }
  };

  const savePassword = async () => {
    setMsg("");
    if (newPw.length < passwordMinLength) {
      setMsg(`新しいパスワードは${passwordMinLength}文字以上にしてください`);
      return;
    }
    if (newPw !== confirmPw) {
      setMsg("確認用と一致しません");
      return;
    }
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setMsg("パスワードを更新しました");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } else {
      setMsg(authenticationFailureMessage(res) ?? `更新に失敗しました: ${data?.error ?? res.status}`);
    }
  };

  const beginTotpSetup = async () => {
    setTwoFaMsg("");
    setRecoveryCodes([]);
    setTwoFaBusy(true);
    try {
      const res = await fetch("/api/me/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "begin" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTwoFaMsg(authenticationFailureMessage(res) ?? `設定を開始できませんでした: ${data?.error ?? res.status}`);
        return;
      }
      setTotpSetup(data as TotpSetup);
    } finally {
      setTwoFaBusy(false);
    }
  };

  const enableTotp = async () => {
    setTwoFaMsg("");
    setTwoFaBusy(true);
    try {
      const res = await fetch("/api/me/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable", code: totpCode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTwoFaMsg(authenticationFailureMessage(res) ?? `有効化に失敗しました: ${data?.error ?? res.status}`);
        return;
      }
      setTotpEnabled(true);
      setTotpSetup(null);
      setTotpCode("");
      setRecoveryCodes(Array.isArray(data?.recovery_codes) ? data.recovery_codes : []);
      setTwoFaMsg("二要素認証を有効化しました");
      if (!mfaPending) router.refresh();
    } finally {
      setTwoFaBusy(false);
    }
  };

  const verifyMfa = async () => {
    setTwoFaMsg("");
    setTwoFaBusy(true);
    try {
      const res = await fetch("/api/me/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useRecoveryCode
          ? { action: "verify", recovery_code: totpCode }
          : { action: "verify", code: totpCode }),
      });
      if (!res.ok) {
        setTwoFaMsg(authenticationFailureMessage(res) ?? "認証コードが正しくありません。再度お試しください。");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setTwoFaBusy(false);
    }
  };

  const disableTotp = async () => {
    setTwoFaMsg("");
    setTwoFaBusy(true);
    try {
      const res = await fetch("/api/me/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", password: disablePassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTwoFaMsg(authenticationFailureMessage(res) ?? `無効化に失敗しました: ${data?.error ?? res.status}`);
        return;
      }
      setTotpEnabled(false);
      setDisablePassword("");
      setRecoveryCodes([]);
      setTwoFaMsg("二要素認証を無効化しました");
      router.refresh();
    } finally {
      setTwoFaBusy(false);
    }
  };

  return (
    <div className="mt-2 divide-y divide-line-subtle">
      <section hidden={mfaPending} className={sectionClass}>
        <h2 className={sectionHeadingClass}>プロフィール{isGuest ? "（ゲスト）" : ""}</h2>
        {scimManaged && (
          <p
            data-scim-managed-profile
            className="mt-3 rounded-md bg-surface-subtle px-3 py-2 text-[12px] leading-5 text-secondary"
          >
            このアカウントは SCIM（{scimIdpLabel(scimIdp)}）で管理されています。
            名前・メールアドレス・役職は IdP で変更してください。
          </p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <UserAvatar name={name} url={avatarUrl} className="h-14 w-14" textClassName="text-lg" />
          <div className="min-w-0 flex-1">
            <label className="block">
              <span className={fieldLabelClass}>写真URL（任意）</span>
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
                className={`mt-1.5 ${fieldControlClass}`}
              />
            </label>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelClass}>表示名</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={scimManaged}
              data-scim-profile-field="name"
              className={`mt-1.5 ${fieldControlClass} read-only:bg-surface-subtle`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>役職・肩書き</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: プロジェクトマネージャー"
              readOnly={scimManaged}
              data-scim-profile-field="title"
              className={`mt-1.5 ${fieldControlClass} read-only:bg-surface-subtle`}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={fieldLabelClass}>メールアドレス</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={scimManaged}
              data-scim-profile-field="email"
              className={`mt-1.5 ${fieldControlClass} read-only:bg-surface-subtle`}
            />
          </label>
        </div>
        <button onClick={saveProfile} className={`mt-4 ${primaryButtonClass}`}>
          プロフィールを保存
        </button>
      </section>

      <section hidden={mfaPending} className={sectionClass}>
        <h2 className={sectionHeadingClass}>パスワード変更</h2>
        <div className="mt-3 grid max-w-md gap-3">
          <label className="block">
            <span className={fieldLabelClass}>現在のパスワード</span>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="現在のパスワード"
              autoComplete="current-password"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>新しいパスワード（{passwordMinLength}文字以上）</span>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder={`新しいパスワード（${passwordMinLength}文字以上）`}
              autoComplete="new-password"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>新しいパスワード（確認）</span>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="新しいパスワード（確認）"
              autoComplete="new-password"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
          <p className={fieldHintClass}>パスワード要件: {passwordPolicyText}</p>
          <button onClick={savePassword} className={`justify-self-start ${primaryButtonClass}`}>
            変更
          </button>
        </div>
      </section>

      <section className={sectionClass} id="two-factor" data-two-factor-section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={sectionHeadingClass}>二要素認証</h2>
          <span
            className={totpEnabled ? pillSuccessClass : pillClass}
            data-two-factor-status
          >
            {totpEnabled ? "有効" : "未設定"}
          </span>
        </div>
        <p className={`mt-1 ${sectionDescriptionClass}`}>
          認証アプリ（Google Authenticator、1Password など）で6桁のコードを生成し、サインイン時に使用します。
        </p>
        {twoFactorPolicy === "required" && !totpEnabled && (
          <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning" data-two-factor-required>
            このワークスペースでは二要素認証が必須です。設定を完了してください。
          </p>
        )}

        {!totpEnabled && !totpSetup && (
          <button
            onClick={beginTotpSetup}
            disabled={twoFaBusy}
            data-two-factor-begin
            className={`mt-3 ${primaryButtonClass}`}
          >
            {twoFaBusy ? "準備中…" : "二要素認証を設定"}
          </button>
        )}

        {totpSetup && (
          <div className="mt-3 rounded-lg bg-surface-subtle p-4" data-two-factor-setup>
            <div className="flex flex-col gap-4 sm:flex-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={totpSetup.qr_data_url}
                alt="二要素認証のQRコード"
                className="h-[220px] w-[220px] shrink-0 self-center rounded border border-line"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-5 text-secondary">
                  認証アプリでQRコードをスキャンするか、下のセットアップキーを入力してください。
                </p>
                <div className="mt-2 rounded-md bg-surface px-2 py-1.5 font-mono text-[11px] break-all" data-two-factor-secret>
                  {totpSetup.secret}
                </div>
                <label className="mt-3 block">
                  <span className={fieldLabelClass}>6桁の確認コード</span>
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    className={`mt-1.5 w-32 text-center font-mono tracking-widest ${fieldControlClass}`}
                    data-two-factor-code
                  />
                </label>
                <button
                  onClick={enableTotp}
                  disabled={twoFaBusy || totpCode.trim().length !== 6}
                  data-two-factor-enable
                  className={`mt-3 ${primaryButtonClass}`}
                >
                  {twoFaBusy ? "確認中…" : "有効化"}
                </button>
              </div>
            </div>
          </div>
        )}

        {mfaPending && totpEnabled && recoveryCodes.length === 0 && (
          <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void verifyMfa(); }}>
            <label className="block max-w-xs">
              <span className={fieldLabelClass}>
                {useRecoveryCode ? "リカバリーコード" : "6桁の認証コード"}
              </span>
              <input
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                inputMode={useRecoveryCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                className={`mt-1.5 ${fieldControlClass}`}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={twoFaBusy || !totpCode.trim()} className={primaryButtonClass}>
                確認
              </button>
              <button
                type="button"
                onClick={() => { setUseRecoveryCode(!useRecoveryCode); setTotpCode(""); }}
                className="text-[13px] text-accent-text hover:underline"
              >
                {useRecoveryCode ? "認証アプリを使う" : "リカバリーコードを使う"}
              </button>
            </div>
          </form>
        )}

        {totpEnabled && !mfaPending && (
          <div className="mt-4 border-t border-line-subtle pt-4">
            <p className="text-[12px] leading-5 text-muted">
              二要素認証は有効です。無効化するには現在のパスワードを入力してください。
            </p>
            <div className="mt-2 flex max-w-sm flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className={fieldLabelClass}>現在のパスワード</span>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="現在のパスワード"
                  autoComplete="current-password"
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <button
                onClick={disableTotp}
                disabled={twoFaBusy || disablePassword === ""}
                data-two-factor-disable
                className={smallDangerButtonClass}
              >
                無効化
              </button>
            </div>
          </div>
        )}

        {recoveryCodes.length > 0 && (
          <div className="mt-3 rounded-lg bg-success-soft p-3" data-two-factor-recovery>
            <div className="text-[12px] font-medium text-success">
              リカバリーコード（この画面を閉じると再表示できません）
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[12px] text-success sm:grid-cols-4">
              {recoveryCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-success">
              安全な場所に保管してください。各コードは1回だけ使用できます。
            </p>
            {mfaPending && (
              <button
                type="button"
                onClick={() => { router.push("/"); router.refresh(); }}
                className="mt-2 inline-flex h-8 items-center justify-center rounded-md bg-success-strong px-3 text-[13px] font-medium text-on-strong hover:bg-success-strong-hover"
              >
                ホームへ進む
              </button>
            )}
          </div>
        )}

        {twoFaMsg && <p role="status" data-auth-feedback className="mt-2 text-[12px] text-secondary">{twoFaMsg}</p>}
      </section>

      {msg && <p className="py-3 text-[12px] text-secondary">{msg}</p>}
      {!mfaPending && <p className="py-3 text-[12px] text-muted">ユーザーID: {userId}</p>}
    </div>
  );
}
