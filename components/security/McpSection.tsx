"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { confirmAction } from "@/lib/ui-feedback";
import type { SecuritySettings } from "@/lib/admin-data";
import {
  beginScimLogPage, finishScimLogPage, type ScimLogPageState,
} from "@/lib/scim/log-paging";
import {
  fieldControlClass,
  fieldHintClass,
  formSectionTitleClass,
  pillClass,
  pillSuccessClass,
  pillWarningClass,
  secondaryButtonClass,
  SelectControl,
  smallDangerButtonClass,
  smallSecondaryButtonClass,
} from "../ui/form-controls";
import { SectionHeader } from "./SectionHeader";

type AdminMcpTokenRow = {
  kind: "pat" | "oauth";
  id?: number;
  family_id?: string;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  name?: string;
  client_name?: string;
  endpoint?: "default" | "readonly";
  scopes: string[];
  read_only: boolean;
  created_at?: string;
  first_authorized_at?: string;
  last_used_at: string | null;
};

type McpLogRow = {
  id: number;
  token_id: number | null;
  token_name: string | null;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  endpoint: "default" | "readonly";
  rpc_method: string | null;
  tool_name: string | null;
  outcome: "ok" | "error" | "denied" | "unauthenticated";
  error_code: string | null;
  duration_ms: number;
  client_name: string | null;
  client_ip: string | null;
  created_at: string;
};

type OutcomeFilter = "all" | McpLogRow["outcome"];

const OUTCOME_OPTIONS: { value: OutcomeFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "ok", label: "成功" },
  { value: "error", label: "エラー" },
  { value: "denied", label: "拒否" },
  { value: "unauthenticated", label: "未認証" },
];

const OUTCOME_LABEL: Record<McpLogRow["outcome"], string> = {
  ok: "成功",
  error: "エラー",
  denied: "拒否",
  unauthenticated: "未認証",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function tokenKey(token: AdminMcpTokenRow): string {
  return token.kind === "pat" ? `pat:${token.id}` : `oauth:${token.family_id}`;
}

function tokenName(token: AdminMcpTokenRow): string {
  return (token.kind === "pat" ? token.name : token.client_name) ?? "–";
}

function tokenUser(token: AdminMcpTokenRow): string {
  if (token.user_name) return token.user_name;
  if (token.user_email) return token.user_email;
  return `ユーザー #${token.user_id}`;
}

function logUser(log: McpLogRow): string {
  if (log.user_name) return log.user_name;
  if (log.user_email) return log.user_email;
  if (log.user_id) return `ユーザー #${log.user_id}`;
  return "–";
}

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
  const [tokens, setTokens] = useState<AdminMcpTokenRow[] | null>(null);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokenMsg, setTokenMsg] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [logPage, setLogPage] = useState<ScimLogPageState<McpLogRow>>({
    logs: [],
    nextCursor: null,
    loading: false,
    requestId: 0,
  });
  const logRequestSeq = useRef(0);
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [logsError, setLogsError] = useState("");

  const logs = logPage.logs;
  const nextCursor = logPage.nextCursor;
  const logsLoading = logPage.loading;
  const refreshBusy = tokensLoading || logsLoading;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  async function loadTokens() {
    if (!isSuper) return;
    setTokensLoading(true);
    try {
      const data = await api<{ tokens: AdminMcpTokenRow[] }>("/api/admin/mcp/tokens");
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch (reason) {
      setTokens((previous) => previous ?? []);
      setTokenMsg(`トークン一覧を取得できませんでした: ${reason instanceof Error ? reason.message : reason}`);
    } finally {
      setTokensLoading(false);
    }
  }

  async function loadLogs(reset: boolean, outcome: OutcomeFilter) {
    if (!isSuper) return;
    const requestId = logRequestSeq.current + 1;
    logRequestSeq.current = requestId;
    const cursor = reset ? null : nextCursor;
    setLogPage((previous) => beginScimLogPage(previous, requestId));
    setLogsError("");
    const params = new URLSearchParams({ outcome });
    if (cursor !== null) params.set("cursor", String(cursor));
    try {
      const data = await api<{ logs: McpLogRow[]; next_cursor: number | null }>(
        `/api/admin/mcp/logs?${params.toString()}`,
      );
      const rows = Array.isArray(data.logs) ? data.logs : [];
      setLogPage((previous) => finishScimLogPage(previous, requestId, {
        ok: true,
        reset,
        rows,
        nextCursor: typeof data.next_cursor === "number" ? data.next_cursor : null,
      }));
    } catch (reason) {
      setLogPage((previous) => finishScimLogPage(previous, requestId, {
        ok: false,
        reset,
        rows: [],
        nextCursor: null,
      }));
      if (requestId === logRequestSeq.current) {
        setLogsError(`リクエストログを取得できませんでした: ${reason instanceof Error ? reason.message : reason}`);
      }
    }
  }

  async function refresh() {
    await Promise.all([
      loadTokens(),
      loadLogs(true, outcomeFilter),
    ]);
  }

  useEffect(() => {
    if (!isSuper) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  useEffect(() => {
    if (!isSuper) return;
    void loadLogs(true, "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

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

  const revokeToken = async (token: AdminMcpTokenRow) => {
    const key = tokenKey(token);
    const ok = await confirmAction(
      `「${tokenName(token)}」を失効させますか？\n失効したトークンはすぐに使えなくなり、元に戻せません。`
      + (token.kind === "oauth" ? "利用中のクライアントは再接続が必要になります。" : ""),
      { title: "MCP トークンを失効", confirmLabel: "失効させる" },
    );
    if (!ok) return;
    setRevoking(key);
    setTokenMsg("");
    try {
      const path = token.kind === "pat"
        ? `/api/admin/mcp/tokens/pat/${token.id}`
        : `/api/admin/mcp/tokens/oauth/${token.family_id}`;
      await api(path, "DELETE");
      setTokens((previous) => previous?.filter((row) => tokenKey(row) !== key) ?? previous);
      setTokenMsg(token.kind === "oauth" ? "OAuth 連携を失効しました" : "トークンを失効しました");
    } catch (reason) {
      setTokenMsg(`失効に失敗しました: ${reason instanceof Error ? reason.message : reason}`);
    } finally {
      setRevoking(null);
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

      <div
        className="mt-6 max-w-3xl border-t border-line-subtle pt-4"
        data-mcp-admin-tokens
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className={formSectionTitleClass}>接続中のトークン</h4>
            <p className={fieldHintClass}>
              ワークスペースで利用できる個人アクセストークンと OAuth 連携です。最終利用日時の新しい順に表示します。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadTokens()}
            disabled={tokensLoading}
            data-mcp-admin-tokens-refresh
            className={smallSecondaryButtonClass}
          >
            {tokensLoading ? "更新中…" : "更新"}
          </button>
        </div>
        {tokenMsg && <p className="mt-2 text-[12px] text-danger" role="status">{tokenMsg}</p>}
        {tokens === null ? (
          <p className="mt-2 text-[13px] text-muted">読み込み中…</p>
        ) : tokens.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">接続中のトークンはありません。</p>
        ) : (
          <div className="mt-2">
            {tokens.map((token) => {
              const key = tokenKey(token);
              return (
                <div
                  key={key}
                  data-mcp-admin-token-row
                  data-mcp-admin-token-kind={token.kind}
                  data-mcp-admin-token-id={token.kind === "pat" ? token.id : token.family_id}
                  className="border-b border-line-subtle py-2.5 text-[12px]"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={pillClass}>
                      {token.kind === "pat" ? "個人アクセストークン" : "OAuth アプリ"}
                    </span>
                    <span className="min-w-0 break-words font-medium text-text">{tokenName(token)}</span>
                    <span className={token.read_only ? pillClass : pillSuccessClass}>
                      {token.read_only ? "読み取りのみ" : "読み取りと書き込み"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted">
                    <span className="min-w-0 break-words">ユーザー: {tokenUser(token)}</span>
                    <span>
                      {token.kind === "pat" ? "作成" : "初回承認"}:{" "}
                      <span className="tabular-nums">
                        {formatTimestamp(token.kind === "pat"
                          ? (token.created_at ?? null)
                          : (token.first_authorized_at ?? null))}
                      </span>
                    </span>
                    <span>
                      最終利用:{" "}
                      <span className="tabular-nums">
                        {token.last_used_at ? formatTimestamp(token.last_used_at) : "未使用"}
                      </span>
                    </span>
                    {token.kind === "oauth" && (
                      <span>
                        エンドポイント: {token.endpoint === "readonly" ? "読み取り専用" : "標準"}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void revokeToken(token)}
                    disabled={revoking !== null}
                    data-mcp-admin-revoke
                    data-mcp-admin-revoke-kind={token.kind}
                    className={`mt-1.5 ${smallDangerButtonClass}`}
                  >
                    {revoking === key ? "失効中…" : "失効"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 rounded-md bg-surface-subtle px-3 py-2 text-[12px] leading-5 text-secondary">
          失効すると、そのトークンを使っているクライアントはすぐに接続できなくなります。
          OAuth の連携は、クライアント側からもう一度承認すると再び接続できます。
        </div>
      </div>

      <div
        className="mt-6 max-w-3xl border-t border-line-subtle pt-4"
        data-mcp-admin-logs
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className={formSectionTitleClass}>リクエストログ</h4>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshBusy}
                data-mcp-admin-refresh
                className={smallSecondaryButtonClass}
              >
                {refreshBusy ? "更新中…" : "再読み込み"}
              </button>
            </div>
            <p className={fieldHintClass}>
              MCP への接続とツール呼び出しの結果を新しい順に表示します（30 日保持）。
            </p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-secondary">
            結果
            <SelectControl
              containerClassName="w-36"
              value={outcomeFilter}
              onChange={(event) => {
                const next = event.target.value as OutcomeFilter;
                setOutcomeFilter(next);
                void loadLogs(true, next);
              }}
              aria-label="結果で絞り込む"
              data-mcp-admin-filter
            >
              {OUTCOME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </SelectControl>
          </label>
        </div>
        {logsError && <p role="alert" className="mt-2 text-[12px] text-danger">{logsError}</p>}
        <div className="mt-2">
          {logs.length === 0 && !logsLoading && !logsError && (
            <p className="text-[13px] text-muted">
              {outcomeFilter === "all"
                ? "まだリクエストの記録はありません。"
                : "この結果に一致するリクエストはありません。"}
            </p>
          )}
          {logs.map((log) => (
            <div
              key={log.id}
              data-mcp-admin-log-row
              data-mcp-admin-log-outcome={log.outcome}
              className="border-b border-line-subtle py-2.5 text-[12px]"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tabular-nums text-muted">{formatTimestamp(log.created_at)}</span>
                <span className={log.outcome === "ok" ? pillSuccessClass : pillWarningClass}>
                  {OUTCOME_LABEL[log.outcome] ?? log.outcome}
                </span>
                <span className="min-w-0 break-words font-medium text-text">
                  {log.tool_name ?? log.rpc_method ?? "–"}
                </span>
                {log.error_code && (
                  <span className="min-w-0 break-all font-mono text-[11px] text-danger">
                    {log.error_code}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted">
                <span className="min-w-0 break-words">ユーザー: {logUser(log)}</span>
                <span className="min-w-0 break-words">
                  クライアント: {log.client_name ?? log.token_name ?? "–"}
                </span>
                <span>
                  所要時間: <span className="tabular-nums">{log.duration_ms} ms</span>
                </span>
                <span>
                  エンドポイント: {log.endpoint === "readonly" ? "読み取り専用" : "標準"}
                </span>
                <span className="min-w-0 break-all">
                  IP: <span className="font-mono text-[11px]">{log.client_ip ?? "–"}</span>
                </span>
              </div>
              {log.token_name && (
                <p className="mt-1 break-words text-[11px] text-subtle">
                  トークン: {log.token_name}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => void loadLogs(false, outcomeFilter)}
            disabled={nextCursor === null || logsLoading}
            data-mcp-admin-load-more
            className={secondaryButtonClass}
          >
            {logsLoading ? "読み込み中…" : "さらに読み込む"}
          </button>
        </div>
      </div>
    </div>
  );
}
