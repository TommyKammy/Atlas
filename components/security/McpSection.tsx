"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { SecuritySettings } from "@/lib/admin-data";
import {
  fieldControlClass,
  fieldHintClass,
  formSectionTitleClass,
  pillClass,
  pillSuccessClass,
  smallSecondaryButtonClass,
} from "../ui/form-controls";
import { SectionHeader } from "./SectionHeader";

function ToggleSwitch({
  kind,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  kind: "mcp" | "pat";
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md bg-surface-subtle px-3 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text">{label}</div>
        <p className="mt-0.5 text-[12px] leading-5 text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-mcp-toggle={kind}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-accent" : "bg-surface-strong"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-4 w-4 rounded-full border border-line-strong bg-surface shadow-sm transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function EndpointList({ origin, onCopy }: { origin: string; onCopy: (value: string) => void }) {
  const defaultUrl = origin ? `${origin}/mcp` : "";
  const readonlyUrl = origin ? `${origin}/mcp/readonly` : "";

  return (
    <div className="mt-6 max-w-3xl">
      <div className={formSectionTitleClass}>接続先 URL</div>
      <div className="mt-2 space-y-2 text-[12px]">
        <div>
          <div className="text-muted">読み取りと書き込み</div>
          <div className="mt-1 flex gap-2">
            <input
              readOnly
              value={defaultUrl}
              placeholder={origin ? undefined : "読み込み中…"}
              aria-label="MCP 接続先 URL"
              data-mcp-endpoint-default
              className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
            />
            <button
              type="button"
              onClick={() => onCopy(defaultUrl)}
              disabled={defaultUrl === ""}
              className={smallSecondaryButtonClass}
            >
              コピー
            </button>
          </div>
        </div>
        <div>
          <div className="text-muted">読み取り専用</div>
          <div className="mt-1 flex gap-2">
            <input
              readOnly
              value={readonlyUrl}
              placeholder={origin ? undefined : "読み込み中…"}
              aria-label="MCP 読み取り専用 URL"
              data-mcp-endpoint-readonly
              className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
            />
            <button
              type="button"
              onClick={() => onCopy(readonlyUrl)}
              disabled={readonlyUrl === ""}
              className={smallSecondaryButtonClass}
            >
              コピー
            </button>
          </div>
        </div>
      </div>
      <p className={`mt-2 ${fieldHintClass}`}>
        読み取り専用の接続先では、トークンに書き込み権限があっても書き込みツールは公開されません。
        「読み取りのみ」の個人アクセストークンを使う方法もあります。
      </p>
    </div>
  );
}

export function McpSection({
  settings,
  onSettings,
  isSuper,
}: {
  settings: SecuritySettings;
  onSettings: (settings: SecuritySettings) => void;
  isSuper: boolean;
}) {
  const [enabled, setEnabled] = useState(settings.mcp_enabled);
  const [patEnabled, setPatEnabled] = useState(settings.mcp_pat_enabled);
  const [saving, setSaving] = useState<"mcp" | "pat" | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const copy = (value: string) => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(value).catch(() => undefined);
  };

  const update = async (kind: "mcp" | "pat", next: boolean) => {
    setSaving(kind);
    setMsg("");
    setError("");
    try {
      const body = kind === "mcp" ? { mcp_enabled: next } : { mcp_pat_enabled: next };
      const data = await api<{ settings: SecuritySettings }>("/api/admin/security", "PATCH", body);
      onSettings(data.settings);
      setEnabled(data.settings.mcp_enabled);
      setPatEnabled(data.settings.mcp_pat_enabled);
      setMsg(kind === "mcp"
        ? (next ? "MCP 接続を許可しました" : "MCP 接続を許可解除しました")
        : (next ? "個人アクセストークンを許可しました" : "個人アクセストークンを許可解除しました"));
    } catch (reason) {
      setError(`変更に失敗しました: ${reason instanceof Error ? reason.message : reason}`);
    } finally {
      setSaving(null);
    }
  };

  if (!isSuper) {
    return (
      <div data-security-section="mcp">
        <SectionHeader
          title="MCP 接続"
          description="Claude Code や Codex などの外部クライアントから Atlas に接続できるようにします。初期状態では無効です。"
        />
        <div
          data-mcp-readonly
          className="mt-4 max-w-3xl rounded-md bg-surface-subtle px-3 py-2 text-[13px] leading-5 text-secondary"
        >
          MCP 接続の設定は super 管理者だけが変更できます。現在の状態: MCP 接続は{" "}
          <span data-mcp-status>{enabled ? "有効" : "無効"}</span>、個人アクセストークンは{" "}
          <span data-mcp-pat-status>{patEnabled ? "有効" : "無効"}</span>。
          ゲストは MCP を利用できません。変更は super 管理者に依頼してください。
        </div>
        <EndpointList origin={origin} onCopy={copy} />
      </div>
    );
  }

  return (
    <div data-security-section="mcp">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="MCP 接続"
          description="Claude Code や Codex などの外部クライアントから Atlas に接続できるようにします。初期状態では無効です。"
        />
        <div className="flex flex-wrap gap-1.5">
          <span className={enabled ? pillSuccessClass : pillClass} data-mcp-status>
            MCP 接続: {enabled ? "有効" : "無効"}
          </span>
          <span className={patEnabled ? pillSuccessClass : pillClass} data-mcp-pat-status>
            PAT: {patEnabled ? "有効" : "無効"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid max-w-3xl gap-2">
        <ToggleSwitch
          kind="mcp"
          label="MCP 接続を許可"
          description="メンバーが Claude Code や Codex から Atlas のツールを使えるようにします。"
          checked={enabled}
          disabled={saving !== null}
          onChange={(next) => void update("mcp", next)}
        />
        <ToggleSwitch
          kind="pat"
          label="個人アクセストークンを許可"
          description="メンバーがプロフィール画面で個人アクセストークンを発行できるようにします。MCP 接続が有効な場合だけ使えます。"
          checked={patEnabled}
          disabled={saving !== null}
          onChange={(next) => void update("pat", next)}
        />
      </div>

      {error && <p role="alert" className="mt-2 max-w-3xl text-[12px] text-danger">{error}</p>}
      {msg && <p role="status" className="mt-2 max-w-3xl text-[12px] text-secondary">{msg}</p>}

      <div className="mt-4 max-w-3xl rounded-md bg-surface-subtle px-3 py-2 text-[12px] leading-5 text-secondary">
        MCP 接続と個人アクセストークンの両方が有効な場合だけ、メンバーはトークンを発行できます。
        ゲストは MCP を利用できません。無効にすると、発行済みのトークンもすぐに使えなくなります。
      </div>

      <EndpointList origin={origin} onCopy={copy} />
    </div>
  );
}
