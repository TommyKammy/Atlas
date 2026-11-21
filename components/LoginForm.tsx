"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { authenticationFailureMessage } from "@/lib/auth-client-feedback";
import {
  fieldControlClass,
  fieldLabelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui/form-controls";

type SamlMode = "off" | "optional" | "required" | "members_only";

export default function LoginForm({ samlMode }: { samlMode: SamlMode }) {
  const router = useRouter();
  const formId = useId();
  const [email, setEmail] = useState("");
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

  return (
    <form
      onSubmit={submit}
      aria-busy={busy}
      className="flex w-full max-w-[320px] flex-col gap-4 rounded-lg border border-line bg-surface p-6"
      data-login-form
    >
      <div>
        <h1 className="text-[16px] font-semibold leading-6 text-text">Atlas にログイン</h1>
        <p className="mt-1 text-[13px] leading-5 text-muted">
          アカウントにサインインします。
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${formId}-email`} className={fieldLabelClass}>メールアドレス</label>
        <input
          id={`${formId}-email`}
          name="email"
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス"
          autoComplete="email"
          className={fieldControlClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${formId}-password`} className={fieldLabelClass}>パスワード</label>
        <input
          id={`${formId}-password`}
          name="password"
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          autoComplete="current-password"
          className={fieldControlClass}
        />
      </div>
      {twoFactorRequired && (
        <div className="rounded-md bg-accent-soft p-3" data-login-two-factor>
          <p className="text-[12px] text-accent-text">二要素認証が必要です。</p>
          <div className="mt-2 space-y-1.5">
            <label htmlFor={`${formId}-verification`} className={fieldLabelClass}>
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
                className={`${fieldControlClass} text-center font-mono tracking-widest`}
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
                className={`${fieldControlClass} font-mono`}
                data-login-recovery
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setUseRecovery((prev) => !prev)}
            className="mt-2 text-[12px] text-accent-text hover:underline"
          >
            {useRecovery ? "認証アプリのコードを使う" : "リカバリーコードを使う"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" data-auth-feedback className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      )}
      {notice && <p className="rounded-md bg-surface-subtle px-3 py-2 text-[12px] text-secondary">{notice}</p>}
      <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>
        ログイン
      </button>
      {samlMode !== "off" && (
        <a
          href="/api/auth/saml/start"
          data-login-saml
          className={`${secondaryButtonClass} w-full`}
        >
          SAML SSO でログイン
        </a>
      )}
      {samlMode === "required" || samlMode === "members_only" ? (
        <p className="text-[12px] leading-5 text-muted">
          SAML SSO が必須です。ゲストと管理者の扱いはワークスペースの設定に従います。
        </p>
      ) : null}
    </form>
  );
}
