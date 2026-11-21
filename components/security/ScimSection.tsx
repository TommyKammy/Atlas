"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { confirmAction } from "@/lib/ui-feedback";
import type { SecuritySettings } from "@/lib/admin-data";
import {
  beginScimLogPage, finishScimLogPage, type ScimLogPageState,
} from "@/lib/scim/log-paging";
import { scimIdpLabel, scimOperationLabel } from "@/lib/scim/log";
import {
  checkboxClass,
  dialogCloseClass,
  dialogSubtitleClass,
  dialogTitleClass,
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  formSectionTitleClass,
  pillClass,
  pillSuccessClass,
  pillWarningClass,
  primaryButtonClass,
  secondaryButtonClass,
  SelectControl,
  smallDangerButtonClass,
  smallSecondaryButtonClass,
} from "../ui/form-controls";
import Dialog from "../ui/Dialog";
import { SectionHeader } from "./SectionHeader";

type ScimTokenRow = {
  id: number;
  name: string;
  idp: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type ScimLogRow = {
  id: number;
  token_id: number | null;
  token_name: string | null;
  idp: string | null;
  method: string;
  path: string;
  filter: string | null;
  status: number;
  scim_type: string | null;
  detail: string | null;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  client_ip: string | null;
  created_at: string;
};

const IDP_OPTIONS = [
  { value: "entra", label: "Entra ID" },
  { value: "okta", label: "Okta" },
  { value: "generic", label: "汎用" },
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

function logTarget(log: ScimLogRow): string {
  if (log.user_name) return log.user_name;
  if (log.user_email) return log.user_email;
  if (log.user_id) return `ユーザー #${log.user_id}`;
  return "–";
}

export function ScimSection({
  settings,
  onSettings,
  isSuper,
}: {
  settings: SecuritySettings;
  onSettings: (settings: SecuritySettings) => void;
  isSuper: boolean;
}) {
  const [enabled, setEnabled] = useState(settings.scim_enabled);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [tokens, setTokens] = useState<ScimTokenRow[] | null>(null);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokenMsg, setTokenMsg] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueName, setIssueName] = useState("");
  const [issueIdp, setIssueIdp] = useState("entra");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);
  const [origin, setOrigin] = useState("");
  const [logPage, setLogPage] = useState<ScimLogPageState<ScimLogRow>>({
    logs: [],
    nextCursor: null,
    loading: false,
    requestId: 0,
  });
  const logRequestSeq = useRef(0);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [logsError, setLogsError] = useState("");

  const logs = logPage.logs;
  const nextCursor = logPage.nextCursor;
  const logsLoading = logPage.loading;

  const endpoint = origin === "" ? "" : `${origin.replace(/\/+$/, "")}/scim/v2`;
  const https = endpoint === "" || endpoint.startsWith("https://");
  const refreshBusy = logsLoading || tokensLoading;

  const copy = (value: string) => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(value).catch(() => undefined);
  };

  async function loadLogs(reset: boolean, failuresOnly: boolean) {
    if (!isSuper) return;
    const requestId = logRequestSeq.current + 1;
    logRequestSeq.current = requestId;
    const cursor = reset ? null : nextCursor;
    setLogPage((previous) => beginScimLogPage(previous, requestId));
    setLogsError("");
    const params = new URLSearchParams({ status: failuresOnly ? "failure" : "all" });
    if (cursor !== null) params.set("cursor", String(cursor));
    try {
      const data = await api<{ logs: ScimLogRow[]; next_cursor: number | null }>(
        `/api/admin/scim/logs?${params.toString()}`,
      );
      const rows = Array.isArray(data.logs) ? data.logs : [];
      setLogPage((previous) => finishScimLogPage(previous, requestId, {
        ok: true,
        reset,
        rows,
        nextCursor: typeof data.next_cursor === "number" ? data.next_cursor : null,
      }));
    } catch (error) {
      setLogPage((previous) => finishScimLogPage(previous, requestId, {
        ok: false,
        reset,
        rows: [],
        nextCursor: null,
      }));
      if (requestId === logRequestSeq.current) {
        setLogsError(`同期の記録を取得できませんでした: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  async function loadTokens() {
    if (!isSuper) return;
    setTokensLoading(true);
    try {
      const data = await api<{ tokens: ScimTokenRow[]; origin?: string }>("/api/admin/scim/tokens");
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
      if (typeof data.origin === "string" && data.origin !== "") setOrigin(data.origin);
    } catch (error) {
      setTokens((previous) => previous ?? []);
      setTokenMsg(`トークン一覧を取得できませんでした: ${error instanceof Error ? error.message : error}`);
    } finally {
      setTokensLoading(false);
    }
  }

  async function refresh() {
    await Promise.all([
      loadTokens(),
      loadLogs(true, onlyFailures),
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
    void loadLogs(true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  const applyEnabled = async (next: boolean) => {
    setSaving(true);
    setMsg("");
    try {
      const data = await api<{ settings: SecuritySettings }>(
        "/api/admin/security",
        "PATCH",
        { scim_enabled: next },
      );
      onSettings(data.settings);
      setEnabled(next);
      setMsg(next ? "SCIM を有効にしました" : "SCIM を無効にしました");
      void loadLogs(true, onlyFailures);
    } catch (error) {
      setMsg(`変更に失敗しました: ${error instanceof Error ? error.message : error}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async () => {
    const next = !enabled;
    if (next) {
      const ok = await confirmAction(
        "SCIM を有効にすると、次の動作になります。\n\n"
        + "・SAML の自動作成（JIT）は停止します。新しいアカウントは IdP からの同期でだけ作られます。\n"
        + "・既存のアカウントとセッションはそのまま残ります。IdP で割り当てていない人も、今までどおりサインインできます。\n"
        + "・割り当てていない人を止めるには、メンバーの管理で無効にするか、SAML を必須にしてください。\n"
        + "・既存のアカウントは、IdP からの同期で同じメールアドレスのものに結び付けられます。\n\n"
        + "続行しますか？",
        { title: "SCIM を有効にしますか？", confirmLabel: "有効にする" },
      );
      if (!ok) return;
    } else {
      const ok = await confirmAction(
        "SCIM を無効にすると、IdP からのプロビジョニングは停止します。"
        + "SAML の自動作成（JIT）は SAML の設定どおりに戻ります。",
        { title: "SCIM を無効にしますか？", confirmLabel: "無効にする" },
      );
      if (!ok) return;
    }
    await applyEnabled(next);
  };

  const issueToken = async () => {
    setIssuing(true);
    setTokenMsg("");
    try {
      const data = await api<ScimTokenRow & { token: string }>(
        "/api/admin/scim/tokens",
        "POST",
        { name: issueName, idp: issueIdp },
      );
      const { token, ...row } = data;
      setIssued({ token, name: row.name });
      setTokens((previous) => (previous ? [...previous, row] : [row]));
      setIssueName("");
    } catch (error) {
      setTokenMsg(`発行に失敗しました: ${error instanceof Error ? error.message : error}`);
    } finally {
      setIssuing(false);
    }
  };

  const closeIssue = () => {
    setIssued(null);
    setIssueOpen(false);
    setIssueName("");
    setTokenMsg("");
  };

  const revokeToken = async (token: ScimTokenRow) => {
    const ok = await confirmAction(
      `「${token.name}」を失効させますか？\n失効したトークンはすぐに使えなくなり、元に戻せません。`
      + "IdP 側の設定も新しいトークンに差し替えてください。",
      { title: "SCIM トークンを失効", confirmLabel: "失効させる" },
    );
    if (!ok) return;
    setTokenMsg("");
    try {
      await api(`/api/admin/scim/tokens/${token.id}`, "DELETE");
      setTokens((previous) => previous?.map((row) => (
        row.id === token.id ? { ...row, revoked_at: new Date().toISOString() } : row
      )) ?? previous);
      setTokenMsg("トークンを失効しました");
    } catch (error) {
      setTokenMsg(`失効に失敗しました: ${error instanceof Error ? error.message : error}`);
    }
  };

  if (!isSuper) {
    return (
      <div data-security-section="scim">
        <SectionHeader
          title="プロビジョニング（SCIM）"
          description="Entra ID や Okta からユーザーの作成・更新・無効化を自動化します。"
        />
        <div
          data-scim-readonly
          className="mt-4 max-w-3xl rounded-md bg-surface-subtle px-3 py-2 text-[13px] leading-5 text-secondary"
        >
          SCIM の設定は super 管理者だけが変更できます。現在の状態:{" "}
          <span data-scim-status>{enabled ? "有効" : "無効"}</span>。
          トークンの発行・失効、有効化・無効化、同期の記録の確認は super 管理者に依頼してください。
        </div>
      </div>
    );
  }

  return (
    <div data-security-section="scim">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="プロビジョニング（SCIM）"
          description="Entra ID や Okta からユーザーの作成・更新・無効化を自動化します。"
        />
        <span className={enabled ? pillSuccessClass : pillClass} data-scim-status>
          {enabled ? "有効" : "無効"}
        </span>
      </div>

      <div className="mt-4 max-w-3xl rounded-lg bg-surface-subtle p-4">
        <div className={formSectionTitleClass}>SCIM プロビジョニング</div>
        <p className="mt-1 text-[12px] leading-5 text-muted">
          有効にすると、IdP が Atlas のユーザーを作成・更新・無効化し、SAML の自動作成（JIT）は停止します。
          既存のアカウントとセッションはそのまま残るため、IdP で割り当てていない人を止めるには、メンバーの管理で無効にするか
          SAML を必須にしてください。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={toggleEnabled}
            disabled={saving}
            data-scim-toggle
            className={enabled ? secondaryButtonClass : primaryButtonClass}
          >
            {saving ? "変更中…" : enabled ? "SCIM を無効にする" : "SCIM を有効にする"}
          </button>
          {msg && <span className="text-[12px] text-secondary" role="status">{msg}</span>}
        </div>
      </div>

      <div className="mt-4 max-w-3xl">
        <div className={formSectionTitleClass}>IdP に設定するテナント URL</div>
        <div className="mt-1.5 flex gap-2">
          <input
            readOnly
            value={endpoint}
            aria-label="SCIM テナント URL"
            data-scim-endpoint
            className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
          />
          <button
            onClick={() => copy(endpoint)}
            data-scim-copy-endpoint
            className={smallSecondaryButtonClass}
          >
            コピー
          </button>
        </div>
        <p className={`mt-1.5 ${fieldHintClass}`}>
          Entra ID の Tenant URL、Okta の Base URL に設定します。
        </p>
        {!https && (
          <p
            data-scim-https-warning
            className="mt-1.5 rounded-md bg-warning-soft px-3 py-2 text-[12px] leading-5 text-warning"
          >
            Entra ID・Okta は HTTPS が必要です。現在の URL は HTTP のため、本番では HTTPS の公開 URL を
            APP_ORIGIN に設定してください。
          </p>
        )}
      </div>

      <div className="mt-6 max-w-3xl border-t border-line-subtle pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className={formSectionTitleClass}>SCIM トークン</h4>
            <p className={fieldHintClass}>IdP ごとに発行し、シークレット トークン / API Token に設定します。</p>
          </div>
          <button
            onClick={() => {
              setIssueOpen(true);
              setTokenMsg("");
            }}
            data-scim-issue-open
            className={primaryButtonClass}
          >
            トークンを発行
          </button>
        </div>
        {tokenMsg && <p className="mt-2 text-[12px] text-danger" role="status">{tokenMsg}</p>}
        {tokens === null ? (
          <p className="mt-2 text-[13px] text-muted">読み込み中…</p>
        ) : tokens.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">発行済みのトークンはありません。</p>
        ) : (
          <div className="mt-2">
            {tokens.map((token) => (
              <div
                key={token.id}
                data-scim-token-row
                data-scim-token-id={token.id}
                data-scim-token-state={token.revoked_at ? "revoked" : "active"}
                className="border-b border-line-subtle py-2 text-[12px]"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words font-medium text-text">{token.name}</span>
                  <span className={pillClass}>{scimIdpLabel(token.idp)}</span>
                  <span
                    data-scim-token-state-label
                    className={token.revoked_at ? pillClass : pillSuccessClass}
                  >
                    {token.revoked_at ? "失効済み" : "有効"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted">
                  <span>作成者: {token.created_by_name ?? "–"}</span>
                  <span>作成: <span className="tabular-nums">{formatTimestamp(token.created_at)}</span></span>
                  <span>
                    最終使用:{" "}
                    <span className="tabular-nums">
                      {token.last_used_at ? formatTimestamp(token.last_used_at) : "未使用"}
                    </span>
                  </span>
                </div>
                {!token.revoked_at && (
                  <button
                    onClick={() => revokeToken(token)}
                    data-scim-token-revoke
                    className={`mt-1.5 ${smallDangerButtonClass}`}
                  >
                    失効
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 rounded-md bg-surface-subtle px-3 py-2 text-[12px] leading-5 text-secondary">
          <strong className="font-semibold">トークンを作り直すとき</strong>
          ： 新しいトークンを発行 → IdP のシークレット トークン / API Token を差し替えて接続テスト →
          古いトークンを失効、の順で行います。先に失効させると同期が止まります。
        </div>
      </div>

      <div className="mt-4 max-w-3xl space-y-2">
        <details className="rounded-md border border-line px-3 py-2" data-scim-idp-help="entra">
          <summary className="cursor-pointer text-[13px] font-medium text-text">
            Entra ID の設定手順（要点・執筆時点）
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-5 text-secondary">
            <li>Microsoft Entra 管理センターでエンタープライズ アプリを作成し、Provisioning を開きます。</li>
            <li>Provisioning Mode を Automatic にし、Tenant URL と Secret Token を設定します。</li>
            <li>接続テストの後に、ユーザーとグループをアプリへ割り当てます。</li>
            <li>属性の対応（userPrincipalName、mail、givenName、surname、jobTitle、active）を確認します。</li>
            <li>Provision on demand で 1 人だけ同期し、「最近の同期」に成功が出ることを確かめます。</li>
          </ol>
        </details>
        <details className="rounded-md border border-line px-3 py-2" data-scim-idp-help="okta">
          <summary className="cursor-pointer text-[13px] font-medium text-text">
            Okta の設定手順（要点・執筆時点）
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-5 text-secondary">
            <li>Okta で SCIM 2.0 対応のアプリ連携を作成し、Provisioning を有効にします。</li>
            <li>Authentication Mode を HTTP Header にし、Base URL と API Token を設定します。</li>
            <li>Create Users、Update User Attributes、Deactivate Users を有効にします。</li>
            <li>属性の対応（userName、email、givenName、familyName、title、active）を確認します。</li>
            <li>Assign したユーザーを同期し、「最近の同期」で結果を確認します。</li>
          </ol>
        </details>
        <p className={fieldHintClass}>
          詳しい手順と属性の対応表は{" "}
          <a href="/help#scim" className="text-accent-text hover:underline">ヘルプの SCIM の項目</a>
          を参照してください。IdP の画面名や項目名は変わることがあります。
        </p>
      </div>

      <div className="mt-6 max-w-3xl border-t border-line-subtle pt-4" data-scim-logs>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className={formSectionTitleClass}>最近の同期</h4>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshBusy}
                data-scim-refresh
                className={smallSecondaryButtonClass}
              >
                {refreshBusy ? "更新中…" : "更新"}
              </button>
            </div>
            <p className={fieldHintClass}>IdP から届いた要求と結果を新しい順に表示します（30 日保持）。</p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-secondary">
            <input
              type="checkbox"
              checked={onlyFailures}
              onChange={(event) => {
                const next = event.target.checked;
                setOnlyFailures(next);
                void loadLogs(true, next);
              }}
              data-scim-failures-only
              className={checkboxClass}
            />
            失敗だけ表示
          </label>
        </div>
        {logsError && <p role="alert" className="mt-2 text-[12px] text-danger">{logsError}</p>}
        <div className="mt-2">
          {logs.length === 0 && !logsLoading && !logsError && (
            <p className="text-[13px] text-muted">
              {onlyFailures ? "失敗した同期はありません。" : "まだ同期の記録はありません。"}
            </p>
          )}
          {logs.map((log) => (
            <div
              key={log.id}
              data-scim-log-row
              data-scim-log-status={log.status < 400 ? "success" : "failure"}
              className="border-b border-line-subtle py-2 text-[12px]"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tabular-nums text-muted">{formatTimestamp(log.created_at)}</span>
                <span className={pillClass}>{scimIdpLabel(log.idp)}</span>
                <span className="font-medium text-text">
                  {scimOperationLabel(log.method, log.path, log.filter)}
                </span>
                <span className="min-w-0 break-words text-secondary">{logTarget(log)}</span>
                <span
                  data-scim-log-result
                  className={log.status < 400 ? pillSuccessClass : pillWarningClass}
                >
                  {log.status < 400 ? "成功" : "失敗"}（{log.status}）
                </span>
              </div>
              <p className="mt-0.5 break-all font-mono text-[11px] text-subtle">
                {log.method} {log.path}
              </p>
              {log.filter && (
                <p className="mt-1 break-all text-[11px] text-muted">条件: {log.filter}</p>
              )}
              {log.detail && (
                <p className="mt-1 break-words text-[11px] text-danger">{log.detail}</p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2">
          <button
            onClick={() => void loadLogs(false, onlyFailures)}
            disabled={nextCursor === null || logsLoading}
            data-scim-load-more
            className={secondaryButtonClass}
          >
            {logsLoading ? "読み込み中…" : "さらに読み込む"}
          </button>
        </div>
      </div>

      <Dialog
        open={issueOpen || issued !== null}
        onClose={closeIssue}
        title={issued ? "トークンを発行しました" : "SCIM トークンを発行"}
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
                data-scim-token-close
                className={dialogCloseClass}
              >
                ×
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-secondary">
              この画面を閉じると二度と表示できません。安全な場所に保管し、IdP の
              シークレット トークン / API Token に設定してください。
            </p>
            <div className="mt-3 flex gap-2">
              <input
                readOnly
                value={issued.token}
                aria-label="SCIM トークン"
                data-scim-token-plaintext
                onFocus={(event) => event.currentTarget.select()}
                className={`${fieldControlClass} min-w-0 flex-1 font-mono`}
              />
              <button
                onClick={() => copy(issued.token)}
                data-scim-token-copy
                className={smallSecondaryButtonClass}
              >
                コピー
              </button>
            </div>
            <div
              data-scim-token-warning
              className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-[12px] leading-5 text-warning"
            >
              この画面を閉じると二度と表示できません。Atlas はハッシュだけを保存するため、再表示できません。
            </div>
            <div className="mt-5 flex justify-end">
              <button onClick={closeIssue} className={secondaryButtonClass}>閉じる</button>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className={dialogTitleClass}>SCIM トークンを発行</h3>
                <p className={dialogSubtitleClass}>IdP ごとに名前を付け、用途を分けてください。</p>
              </div>
              <button
                onClick={closeIssue}
                aria-label="閉じる"
                data-scim-token-close
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
                  placeholder="例: Entra 本番"
                  data-scim-token-name
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>IdP</span>
                <SelectControl
                  containerClassName="mt-1.5"
                  value={issueIdp}
                  onChange={(event) => setIssueIdp(event.target.value)}
                  data-scim-token-idp
                >
                  {IDP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </SelectControl>
              </label>
            </div>
            {tokenMsg && <p className="mt-2 text-[12px] text-danger" role="alert">{tokenMsg}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeIssue} className={secondaryButtonClass}>キャンセル</button>
              <button
                onClick={issueToken}
                disabled={issuing || issueName.trim() === ""}
                data-scim-token-issue
                className={primaryButtonClass}
              >
                {issuing ? "発行中…" : "発行"}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
