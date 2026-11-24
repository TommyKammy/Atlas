"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { confirmAction } from "@/lib/ui-feedback";
import {
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  formSectionTitleClass,
  pillClass,
  primaryButtonClass,
  secondaryButtonClass,
  SelectControl,
  smallDangerButtonClass,
  smallSecondaryButtonClass,
  dialogCloseClass,
  dialogSubtitleClass,
  dialogTitleClass,
} from "../ui/form-controls";
import Dialog from "../ui/Dialog";

type TokenAccess = "read" | "read_write";

type TokenRow = {
  id: number;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type CreatedToken = {
  id: number;
  token: string;
  name: string;
  scopes: string[];
  created_at: string;
};

const sectionClass = "mt-2 border-t border-line-subtle py-6";
const sectionHeadingClass = "text-[16px] font-semibold leading-6 text-text";
const sectionDescriptionClass = "mt-1 text-[13px] leading-5 text-muted";

const ACCESS_OPTIONS: { value: TokenAccess; label: string }[] = [
  { value: "read_write", label: "読み取りと書き込み" },
  { value: "read", label: "読み取りのみ" },
];

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

function accessLabel(scopes: string[]): string {
  return Array.isArray(scopes) && scopes.includes("write") ? "読み取りと書き込み" : "読み取りのみ";
}

function ConnectionSnippets({
  origin,
  token,
  onCopy,
}: {
  origin: string;
  token: string | null;
  onCopy: (value: string) => void;
}) {
  const placeholder = token ?? "<TOKEN>";
  const claudeCommand =
    `claude mcp add --transport http atlas ${origin}/mcp --header "Authorization: Bearer ${placeholder}"`;
  const codexConfig =
    `[mcp_servers.atlas]\nurl = "${origin}/mcp"\nbearer_token_env_var = "ATLAS_MCP_TOKEN"`;
  const envCommand = `export ATLAS_MCP_TOKEN="${placeholder}"`;

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-line bg-surface-subtle p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 text-[12px] font-semibold text-text">Claude Code</div>
          <button
            type="button"
            onClick={() => onCopy(claudeCommand)}
            data-mcp-copy-claude
            className={smallSecondaryButtonClass}
          >
            コピー
          </button>
        </div>
        <pre
          data-mcp-claude-command
          className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-secondary"
        >
          {claudeCommand}
        </pre>
      </div>

      <div className="rounded-md border border-line bg-surface-subtle p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 text-[12px] font-semibold text-text">
            Codex（~/.codex/config.toml）
          </div>
          <button
            type="button"
            onClick={() => onCopy(codexConfig)}
            data-mcp-copy-codex
            className={smallSecondaryButtonClass}
          >
            コピー
          </button>
        </div>
        <pre
          data-mcp-codex-config
          className="mt-1.5 overflow-x-auto whitespace-pre font-mono text-[11px] leading-5 text-secondary"
        >
          {codexConfig}
        </pre>
        <p className="mt-2 text-[12px] leading-5 text-secondary">
          ターミナルで環境変数 <code className="font-mono">ATLAS_MCP_TOKEN</code> にトークンを設定してから
          Codex を起動してください。
        </p>
        <div className="mt-1.5 flex gap-2">
          <input
            readOnly
            value={envCommand}
            aria-label="Codex 用の環境変数"
            data-mcp-env-command
            onFocus={(event) => event.currentTarget.select()}
            className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
          />
          <button
            type="button"
            onClick={() => onCopy(envCommand)}
            data-mcp-copy-env
            className={smallSecondaryButtonClass}
          >
            コピー
          </button>
        </div>
      </div>

      <p className={fieldHintClass} data-mcp-readonly-note>
        読み取り専用で接続したい場合は、URL を{" "}
        <code className="font-mono">{origin}/mcp/readonly</code> にしてください。
        Claude Code では <code className="font-mono">atlas-readonly</code> など別名で追加すると、
        書き込み可能な接続と併用できます。「読み取りのみ」のトークンなら、どちらの URL でも書き込みはできません。
      </p>
    </div>
  );
}

export function McpConnectionSection({
  isGuest,
  mcpEnabled,
  mcpPatEnabled,
}: {
  isGuest: boolean;
  mcpEnabled: boolean;
  mcpPatEnabled: boolean;
}) {
  const [origin, setOrigin] = useState("");
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueName, setIssueName] = useState("");
  const [issueAccess, setIssueAccess] = useState<TokenAccess>("read_write");
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [issued, setIssued] = useState<CreatedToken | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const canIssue = mcpEnabled && mcpPatEnabled;
  const activeTokens = tokens?.filter((token) => token.revoked_at === null) ?? [];

  const copy = (value: string) => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(value).catch(() => undefined);
  };

  async function loadTokens() {
    setTokensLoading(true);
    setListError("");
    try {
      const data = await api<{ tokens: TokenRow[] }>("/api/me/mcp-tokens");
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch (error) {
      setTokens((previous) => previous ?? []);
      setListError(`トークン一覧を取得できませんでした: ${error instanceof Error ? error.message : error}`);
    } finally {
      setTokensLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    void loadTokens();
  }, []);

  if (isGuest) return null;

  const openIssue = () => {
    setIssueOpen(true);
    setIssueError("");
    setNotice("");
  };

  const closeIssue = () => {
    setIssued(null);
    setIssueOpen(false);
    setIssueName("");
    setIssueAccess("read_write");
    setIssueError("");
  };

  const issueToken = async () => {
    const name = issueName.trim();
    if (name === "") return;
    setIssuing(true);
    setIssueError("");
    try {
      const created = await api<CreatedToken>("/api/me/mcp-tokens", "POST", {
        name,
        access: issueAccess,
      });
      const row: TokenRow = {
        id: created.id,
        name: created.name,
        scopes: created.scopes,
        created_at: created.created_at,
        last_used_at: null,
        revoked_at: null,
      };
      setIssued(created);
      setTokens((previous) => [row, ...(previous ?? [])]);
      setIssueName("");
      setNotice("トークンを発行しました");
    } catch (error) {
      setIssueError(`発行に失敗しました: ${error instanceof Error ? error.message : error}`);
    } finally {
      setIssuing(false);
    }
  };

  const revokeToken = async (token: TokenRow) => {
    const ok = await confirmAction(
      `「${token.name}」を失効させますか？\n失効したトークンはすぐに使えなくなり、元に戻せません。`
        + "接続中の Claude Code や Codex では、新しいトークンを設定してください。",
      { title: "MCP トークンを失効", confirmLabel: "失効させる" },
    );
    if (!ok) return;
    setRevokingId(token.id);
    setListError("");
    setNotice("");
    try {
      await api(`/api/me/mcp-tokens/${token.id}`, "DELETE");
      setTokens((previous) => previous?.filter((row) => row.id !== token.id) ?? previous);
      setNotice("トークンを失効しました");
    } catch (error) {
      setListError(`失効に失敗しました: ${error instanceof Error ? error.message : error}`);
    } finally {
      setRevokingId(null);
    }
  };

  const disabledReason = !mcpEnabled
    ? "管理者が MCP 接続を有効にすると利用できます。"
    : "管理者が個人アクセストークンを有効にすると利用できます。";

  return (
    <section className={sectionClass} data-mcp-section>
      <h2 className={sectionHeadingClass}>MCP 接続</h2>
      <p className={sectionDescriptionClass}>
        Claude Code や Codex から Atlas に接続するための個人アクセストークンを管理します。
        トークンは本人の権限の範囲内でだけ使えます。
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className={formSectionTitleClass}>個人アクセストークン</h3>
          <p className={fieldHintClass}>
            クライアントごとに名前を付け、不要になったら失効してください。有効期限はありません。
          </p>
        </div>
        {canIssue && (
          <button onClick={openIssue} data-mcp-issue-open className={primaryButtonClass}>
            トークンを発行
          </button>
        )}
      </div>

      {!canIssue && (
        <p
          data-mcp-disabled
          className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-[12px] leading-5 text-warning"
        >
          {disabledReason}
        </p>
      )}

      {listError && <p className="mt-2 text-[12px] text-danger" role="alert">{listError}</p>}
      {notice && <p className="mt-2 text-[12px] text-secondary" role="status">{notice}</p>}

      {tokens === null || tokensLoading ? (
        <p className="mt-2 text-[13px] text-muted">読み込み中…</p>
      ) : activeTokens.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">有効なトークンはありません。</p>
      ) : (
        <div className="mt-2">
          {activeTokens.map((token) => (
            <div
              key={token.id}
              data-mcp-token-row
              data-mcp-token-id={token.id}
              className="border-b border-line-subtle py-2 text-[12px]"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 break-words font-medium text-text">{token.name}</span>
                <span className={pillClass}>{accessLabel(token.scopes)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted">
                <span>
                  作成: <span className="tabular-nums">{formatTimestamp(token.created_at)}</span>
                </span>
                <span>
                  最終使用:{" "}
                  <span className="tabular-nums">
                    {token.last_used_at ? formatTimestamp(token.last_used_at) : "未使用"}
                  </span>
                </span>
              </div>
              <button
                onClick={() => void revokeToken(token)}
                disabled={revokingId === token.id}
                data-mcp-token-revoke
                className={`mt-1.5 ${smallDangerButtonClass}`}
              >
                {revokingId === token.id ? "失効中…" : "失効"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 border-t border-line-subtle pt-4">
        <h3 className={formSectionTitleClass}>接続設定</h3>
        <p className={`mt-1 ${fieldHintClass}`}>
          発行したトークンを Authorization ヘッダーに付けます。ここでは{" "}
          <code className="font-mono">{"<TOKEN>"}</code> をプレースホルダーとして表示しています。
          発行直後の画面では、発行したトークンを埋め込んだ設定を表示します。
        </p>
        {origin ? (
          <ConnectionSnippets origin={origin} token={null} onCopy={copy} />
        ) : (
          <p className="mt-2 text-[13px] text-muted">接続先を準備しています…</p>
        )}
      </div>

      <Dialog
        open={issueOpen || issued !== null}
        onClose={closeIssue}
        title={issued ? "トークンを発行しました" : "MCP トークンを発行"}
        panelClassName="w-[min(620px,94vw)] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface shadow-2xl"
      >
        {issued ? (
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className={dialogTitleClass}>トークンを発行しました</h3>
                <p className={`${dialogSubtitleClass} break-words`}>{issued.name}</p>
              </div>
              <button
                onClick={closeIssue}
                aria-label="閉じる"
                data-mcp-token-close
                className={dialogCloseClass}
              >
                ×
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-secondary">
              このトークンは一度だけ表示されます。接続先の設定にコピーし、安全な場所に保管してください。
            </p>
            <div className="mt-3 flex gap-2">
              <input
                readOnly
                value={issued.token}
                aria-label="MCP トークン"
                data-mcp-token-plaintext
                onFocus={(event) => event.currentTarget.select()}
                className={`${fieldControlClass} min-w-0 flex-1 font-mono`}
              />
              <button
                onClick={() => copy(issued.token)}
                data-mcp-token-copy
                className={smallSecondaryButtonClass}
              >
                コピー
              </button>
            </div>
            <p
              data-mcp-token-warning
              className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-[12px] leading-5 text-warning"
            >
              この画面を閉じると二度と表示されません。Atlas はハッシュだけを保存するため、再表示できません。
              安全な場所に保管してください。
            </p>
            {origin && <ConnectionSnippets origin={origin} token={issued.token} onCopy={copy} />}
            <div className="mt-5 flex justify-end">
              <button onClick={closeIssue} className={secondaryButtonClass}>閉じる</button>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className={dialogTitleClass}>MCP トークンを発行</h3>
                <p className={dialogSubtitleClass}>
                  トークンは発行時に一度だけ表示されます。用途ごとに名前を付けてください。
                </p>
              </div>
              <button
                onClick={closeIssue}
                aria-label="閉じる"
                data-mcp-token-close
                className={dialogCloseClass}
              >
                ×
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className={fieldLabelClass}>名前</span>
                <input
                  value={issueName}
                  onChange={(event) => setIssueName(event.target.value)}
                  maxLength={100}
                  placeholder="例: 自宅の Claude Code"
                  data-mcp-token-name
                  className={`mt-1.5 ${fieldControlClass}`}
                />
                <span className={`mt-1 block ${fieldHintClass}`}>100文字以内。クライアント名や用途を書くと見分けやすくなります。</span>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>権限</span>
                <SelectControl
                  containerClassName="mt-1.5"
                  value={issueAccess}
                  onChange={(event) => setIssueAccess(event.target.value as TokenAccess)}
                  data-mcp-token-access
                >
                  {ACCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </SelectControl>
                <span className={`mt-1 block ${fieldHintClass}`}>
                  作成・変更をさせたくない場合は「読み取りのみ」を選んでください。
                  付与される権限は、あなたの現在の権限の範囲内です。
                </span>
              </label>
            </div>
            {issueError && <p className="mt-2 text-[12px] text-danger" role="alert">{issueError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeIssue} className={secondaryButtonClass}>キャンセル</button>
              <button
                onClick={() => void issueToken()}
                disabled={issuing || issueName.trim() === ""}
                data-mcp-token-issue
                className={primaryButtonClass}
              >
                {issuing ? "発行中…" : "発行"}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
