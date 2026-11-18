"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { authenticationFailureMessage } from "@/lib/auth-client-feedback";

type SamlMode = "off" | "optional" | "required" | "members_only";

export default function LoginForm({ samlMode }: { samlMode: SamlMode }) {
  const router = useRouter();
  const formId = useId();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("saml") === "disabled") setNotice("このワークスペースでは SAML SSO は無効です。");
    const samlError = params.get("saml_error");
    if (samlError) {
      const messages: Record<string, string> = {
        disabled: "SAML SSO は無効です。",
        missing_response: "SAML レスポンスがありません。",
        invalid_response: "SAML レスポンスが無効です。",
        invalid_signature: "SAML レスポンスの署名を検証できませんでした。",
        invalid_state: "SAML ログインを開始したブラウザで、もう一度ログインしてください。",
        missing_email: "SAML レスポンスにメールアドレスが含まれていません。",
        deactivated: "このアカウントは無効化されています。",
        user_not_found: "SAML ユーザーが見つかりません。管理者に連絡してください。",
        user_conflict: "ユーザーの作成に失敗しました。",
        no_default_role: "既定の役割が設定されていません。",
      };
      setNotice(messages[samlError] ?? "SAML サインインに失敗しました。");
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
    const body: Record<string, string> = { email, password };
    if (twoFactorRequired) {
      if (useRecovery) body.recovery_code = recoveryCode;
      else body.totp = totp;
    }
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      if (data?.two_factor_setup_required) {
        router.push("/profile#two-factor");
      } else {
        router.push("/");
      }
      router.refresh();
      return;
    }
    const limited = authenticationFailureMessage(res);
    if (limited) { setError(limited); return; }
    if (data?.two_factor_required) {
      setTwoFactorRequired(true);
      setError("認証アプリの6桁コードを入力してください");
      return;
    }
    if (data?.saml_required) {
      setError("このワークスペースでは SAML SSO でのサインインが必要です");
      setNotice("下の「SAML SSO でログイン」からサインインしてください。管理者はパスワードでもログインできます。");
      return;
    }
    if (data?.error === "invalid two-factor code") {
      setError("二要素認証コードが正しくありません");
      return;
    }
    setError("メールアドレスまたはパスワードが違います");
    } catch {
      setError("通信に失敗しました。入力内容は保持しています。接続を確認して再試行してください。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const field = "w-full rounded border px-3 py-2 text-sm outline-none focus:border-blue-500";
  return (
    <form onSubmit={submit} aria-busy={busy} className="flex w-80 flex-col gap-3 rounded-lg border bg-surface p-6 shadow" data-login-form>
      <h1 className="text-lg font-bold">Atlas にログイン</h1>
      <label htmlFor={`${formId}-email`} className="text-sm font-medium">メールアドレス</label>
      <input
        id={`${formId}-email`}
        name="email"
        required
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="メールアドレス"
        autoComplete="email"
        className={field}
      />
      <label htmlFor={`${formId}-password`} className="text-sm font-medium">パスワード</label>
      <input
        id={`${formId}-password`}
        name="password"
        required
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="パスワード"
        autoComplete="current-password"
        className={field}
      />
      {twoFactorRequired && (
        <div className="rounded border border-blue-200 bg-blue-50 p-2" data-login-two-factor>
          <p className="text-[11px] text-blue-900">二要素認証が必要です。</p>
          <label htmlFor={`${formId}-verification`} className="mt-2 block text-sm font-medium">
            {useRecovery ? "リカバリーコード" : "認証アプリのコード"}
          </label>
          {!useRecovery ? (
            <input
              id={`${formId}-verification`}
              name="totp"
              required
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              placeholder="6桁のコード"
              autoComplete="one-time-code"
              className={`${field} mt-1 text-center font-mono tracking-widest`}
              data-login-totp
            />
          ) : (
            <input
              id={`${formId}-verification`}
              name="recovery_code"
              required
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="リカバリーコード"
              className={`${field} mt-1 font-mono`}
              data-login-recovery
            />
          )}
          <button
            type="button"
            onClick={() => setUseRecovery((prev) => !prev)}
            className="mt-1 text-[11px] text-blue-700 hover:underline"
          >
            {useRecovery ? "認証アプリのコードを使う" : "リカバリーコードを使う"}
          </button>
        </div>
      )}
      {error && <p role="alert" data-auth-feedback className="text-sm text-danger">{error}</p>}
      {notice && <p className="text-xs text-secondary">{notice}</p>}
      <button type="submit" disabled={busy} className="rounded bg-blue-600 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
        ログイン
      </button>
      {samlMode !== "off" && (
        <a
          href="/api/auth/saml/start"
          data-login-saml
          className="rounded border border-[#4075cf] py-2 text-center text-sm text-[#2f5fa8] hover:bg-blue-50"
        >
          SAML SSO でログイン
        </a>
      )}
      {samlMode === "required" || samlMode === "members_only" ? (
        <p className="text-[11px] text-muted">
          SAML SSO が必須です。ゲストと管理者の扱いはワークスペースの設定に従います。
        </p>
      ) : (
        <p className="text-xs text-subtle">開発用初期値：admin@example.com / atlas-dev-2026</p>
      )}
    </form>
  );
}
