"use client";

import { authenticationFailureMessage } from "@/lib/auth-client-feedback";

import { useRouter } from "next/navigation";
import { useState } from "react";
import UserAvatar from "./UserAvatar";

type TotpSetup = {
  secret: string;
  otpauth_uri: string;
  qr_data_url: string;
};

export default function ProfileForm({
  userId,
  initialName,
  initialEmail,
  initialTitle,
  initialAvatarUrl,
  isGuest,
  initialTotpEnabled,
  mfaPending,
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
  twoFactorPolicy: "optional" | "required";
  passwordMinLength: number;
  passwordPolicyText: string;
}) {
  const router = useRouter();
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
    if (!name.trim()) {
      setMsg("名前を入力してください");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMsg("有効なメールアドレスを入力してください");
      return;
    }
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, title, avatar_url: avatarUrl }),
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

  const field = "w-full rounded border px-2 py-1.5 text-sm outline-none focus:border-blue-500";
  return (
    <div className="mt-4 space-y-6">
      <section hidden={mfaPending} className="rounded-lg border p-4">
        <h2 className="font-semibold">プロフィール{isGuest ? "（ゲスト）" : ""}</h2>
        <div className="mt-3 flex items-center gap-3">
          <UserAvatar name={name} url={avatarUrl} className="h-14 w-14" textClassName="text-lg" />
          <div className="min-w-0 flex-1">
            <label className="text-xs text-neutral-500">写真URL（任意）</label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
              className={field}
            />
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-neutral-500">
            表示名
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="text-xs text-neutral-500">
            役職・肩書き
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: プロジェクトマネージャー"
              className={field}
            />
          </label>
          <label className="text-xs text-neutral-500 sm:col-span-2">
            メールアドレス
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </label>
        </div>
        <button
          onClick={saveProfile}
          className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          プロフィールを保存
        </button>
      </section>
      <section hidden={mfaPending} className="rounded-lg border p-4">
        <h2 className="font-semibold">パスワード変更</h2>
        <div className="mt-2 flex flex-col gap-2">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="現在のパスワード"
            autoComplete="current-password"
            className={field}
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder={`新しいパスワード（${passwordMinLength}文字以上）`}
            autoComplete="new-password"
            className={field}
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="新しいパスワード（確認）"
            autoComplete="new-password"
            className={field}
          />
          <p className="text-[11px] text-neutral-400">パスワード要件: {passwordPolicyText}</p>
          <button
            onClick={savePassword}
            className="self-start rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            変更
          </button>
        </div>
      </section>

      <section className="rounded-lg border p-4" id="two-factor" data-two-factor-section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">二要素認証</h2>
          <span
            className={`rounded px-2 py-0.5 text-[11px] ${
              totpEnabled ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"
            }`}
            data-two-factor-status
          >
            {totpEnabled ? "有効" : "未設定"}
          </span>
        </div>
        {twoFactorPolicy === "required" && !totpEnabled && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" data-two-factor-required>
            このワークスペースでは二要素認証が必須です。設定を完了してください。
          </p>
        )}
        <p className="mt-1 text-[12px] text-neutral-500">
          認証アプリ（Google Authenticator、1Password など）で6桁のコードを生成し、サインイン時に使用します。
        </p>

        {!totpEnabled && !totpSetup && (
          <button
            onClick={beginTotpSetup}
            disabled={twoFaBusy}
            data-two-factor-begin
            className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {twoFaBusy ? "準備中…" : "二要素認証を設定"}
          </button>
        )}

        {totpSetup && (
          <div className="mt-3 rounded-lg border border-neutral-200 p-3" data-two-factor-setup>
            <div className="flex flex-col gap-3 sm:flex-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={totpSetup.qr_data_url}
                alt="二要素認証のQRコード"
                className="h-[220px] w-[220px] shrink-0 self-center rounded border"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-600">
                  認証アプリでQRコードをスキャンするか、下のセットアップキーを入力してください。
                </p>
                <div className="mt-2 rounded bg-neutral-50 px-2 py-1.5 font-mono text-[11px] break-all" data-two-factor-secret>
                  {totpSetup.secret}
                </div>
                <label className="mt-3 block text-xs text-neutral-600">
                  6桁の確認コード
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    className={`${field} mt-1 w-32 text-center font-mono tracking-widest`}
                    data-two-factor-code
                  />
                </label>
                <button
                  onClick={enableTotp}
                  disabled={twoFaBusy || totpCode.trim().length !== 6}
                  data-two-factor-enable
                  className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {twoFaBusy ? "確認中…" : "有効化"}
                </button>
              </div>
            </div>
          </div>
        )}

        {mfaPending && totpEnabled && recoveryCodes.length === 0 && (
          <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void verifyMfa(); }}>
            <label className="block text-xs text-neutral-600">
              {useRecoveryCode ? "リカバリーコード" : "6桁の認証コード"}
              <input
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                inputMode={useRecoveryCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                className={`${field} mt-1 w-48`}
              />
            </label>
            <button type="submit" disabled={twoFaBusy || !totpCode.trim()} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              確認
            </button>
            <button
              type="button"
              onClick={() => { setUseRecoveryCode(!useRecoveryCode); setTotpCode(""); }}
              className="ml-2 text-sm text-blue-700"
            >
              {useRecoveryCode ? "認証アプリを使う" : "リカバリーコードを使う"}
            </button>
          </form>
        )}

        {totpEnabled && !mfaPending && (
          <div className="mt-3">
            <p className="text-xs text-neutral-500">
              二要素認証は有効です。無効化するには現在のパスワードを入力してください。
            </p>
            <div className="mt-2 flex max-w-sm gap-2">
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="現在のパスワード"
                autoComplete="current-password"
                className={field}
              />
              <button
                onClick={disableTotp}
                disabled={twoFaBusy || disablePassword === ""}
                data-two-factor-disable
                className="shrink-0 rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                無効化
              </button>
            </div>
          </div>
        )}

        {recoveryCodes.length > 0 && (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3" data-two-factor-recovery>
            <div className="text-xs font-medium text-emerald-900">
              リカバリーコード（この画面を閉じると再表示できません）
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[12px] text-emerald-900 sm:grid-cols-4">
              {recoveryCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-emerald-800">
              安全な場所に保管してください。各コードは1回だけ使用できます。
            </p>
            {mfaPending && (
              <button
                type="button"
                onClick={() => { router.push("/"); router.refresh(); }}
                className="mt-2 rounded bg-emerald-800 px-3 py-1.5 text-sm text-white"
              >
                ホームへ進む
              </button>
            )}
          </div>
        )}

        {twoFaMsg && <p role="status" data-auth-feedback className="mt-2 text-sm text-neutral-600">{twoFaMsg}</p>}
      </section>

      {msg && <p className="text-sm text-neutral-600">{msg}</p>}
      {!mfaPending && <p className="text-xs text-neutral-400">ユーザーID: {userId}</p>}
    </div>
  );
}
