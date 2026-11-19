"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { SecuritySettings } from "@/lib/admin-data";
import {
  checkboxClass,
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  fieldTextareaClass,
  formSectionTitleClass,
  primaryButtonClass,
  smallSecondaryButtonClass,
} from "../ui/form-controls";
import { SectionHeader } from "./SectionHeader";

export function SamlSection({
  settings,
  onSettings,
}: {
  settings: SecuritySettings;
  onSettings: (settings: SecuritySettings) => void;
}) {
  const [mode, setMode] = useState(settings.saml_mode);
  const [signinUrl, setSigninUrl] = useState(settings.saml_signin_url);
  const [certificate, setCertificate] = useState(settings.saml_certificate);
  const [sessionDays, setSessionDays] = useState(String(settings.saml_session_days));
  const [jit, setJit] = useState(settings.saml_jit_provisioning);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const data = await api<{ settings: SecuritySettings }>("/api/admin/security", "PATCH", {
        saml_mode: mode,
        saml_signin_url: signinUrl,
        saml_certificate: certificate,
        saml_session_days: Number(sessionDays),
        saml_jit_provisioning: jit,
      });
      onSettings(data.settings);
      setMsg("SAML の設定を保存しました");
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const acsUrl = `${origin}/api/auth/saml/callback`;
  const metadataUrl = `${origin}/api/auth/saml/metadata`;
  const issuer = `atlas-sp-${settings.workspace_id}`;

  const copy = (value: string) => navigator.clipboard?.writeText(value).catch(() => undefined);

  return (
    <div data-security-section="saml">
      <SectionHeader
        title="SAML 認証"
        description="Azure、Okta、OneLogin または SAML のカスタムソリューションでセットアップします。"
      />

      <div className="mt-4 max-w-3xl">
        <div className={formSectionTitleClass}>SAML のモード</div>
        <div className="mt-2 space-y-2 text-[13px] text-secondary">
          {(
            [
              ["off", "オフ"],
              ["optional", "任意"],
              ["required", "必須（すべてのメンバーとゲスト）"],
              ["members_only", "必須（ゲストアカウントを除くすべてのメンバー）"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="saml-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
                data-saml-mode={value}
                className={checkboxClass}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className={`mt-2 ${fieldHintClass}`}>
          必須にすると、対象ユーザーのパスワード認証による既存セッションも失効し、SAML SSO での再サインインが必要になります。SAML 認証済みのセッションは維持します。管理者は緊急時のためにパスワードでサインインできます。
        </p>

        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className={fieldLabelClass}>サインインページの URL</span>
            <input
              value={signinUrl}
              onChange={(e) => setSigninUrl(e.target.value)}
              placeholder="https://company-app.okta.com/app/company/..."
              className={`mt-1.5 ${fieldControlClass}`}
              data-saml-signin-url
            />
            <span className={`mt-1.5 block ${fieldHintClass}`}>
              このフィールドは IdP から提供されます。「ログイン URL」というラベルが付いている場合があります。
            </span>
          </label>
          <label className="block">
            <span className={fieldLabelClass}>X.509 証明書</span>
            <textarea
              value={certificate}
              onChange={(e) => setCertificate(e.target.value)}
              placeholder="ここに X.509 証明書をコピーして貼り付け…"
              rows={6}
              className={`mt-1.5 font-mono text-[12px] ${fieldTextareaClass}`}
              data-saml-certificate
            />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className={fieldLabelClass}>セッションタイムアウト</span>
              <div className="mt-1.5 flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={sessionDays}
                  onChange={(e) => setSessionDays(e.target.value)}
                  className={`${fieldControlClass} w-20 tabular-nums`}
                  data-saml-session-days
                />
                <span className="text-[13px] text-muted">日</span>
              </div>
            </label>
            <label className="flex items-center gap-2 pb-2 text-[13px] text-secondary">
              <input
                type="checkbox"
                checked={jit}
                onChange={(e) => setJit(e.target.checked)}
                className={checkboxClass}
              />
              初回サインイン時にユーザーを自動作成する
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            data-saml-save
            className={primaryButtonClass}
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-[12px] text-secondary">{msg}</span>}
        </div>
      </div>

      <div className="mt-6 max-w-3xl rounded-lg bg-surface-subtle p-4">
        <h4 className={formSectionTitleClass}>IdP に登録するサービスプロバイダー情報</h4>
        <div className="mt-2 space-y-2 text-[12px]">
          <div>
            <div className="text-muted">ACS URL</div>
            <div className="mt-1 flex gap-2">
              <input
                readOnly
                value={acsUrl}
                aria-label="ACS URL"
                className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
              />
              <button onClick={() => copy(acsUrl)} className={smallSecondaryButtonClass}>
                コピー
              </button>
            </div>
          </div>
          <div>
            <div className="text-muted">SP メタデータ URL</div>
            <div className="mt-1 flex gap-2">
              <input
                readOnly
                value={metadataUrl}
                aria-label="SP メタデータ URL"
                className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
              />
              <button onClick={() => copy(metadataUrl)} className={smallSecondaryButtonClass}>
                コピー
              </button>
            </div>
          </div>
          <div>
            <div className="text-muted">Issuer / Entity ID</div>
            <div className="mt-1 flex gap-2">
              <input
                readOnly
                value={issuer}
                aria-label="Issuer / Entity ID"
                className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
              />
              <button onClick={() => copy(issuer)} className={smallSecondaryButtonClass}>
                コピー
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
