"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import type { ManualRuleExecution, ProjectRule, RuleRun } from "@/lib/automation/types";
import { confirmAction, toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";
import AutomationRuleBuilder from "./AutomationRuleBuilder";
import RuleDraftList from "../automation/RuleDraftList";

function triggerText(rule: ProjectRule, descriptors: RuleDescriptors | null): string {
  const labels = rule.definition.triggers.map(
    (trigger) =>
      descriptors?.triggers.find((entry) => entry.id === trigger.event)?.label ?? trigger.event,
  );
  return labels.join(" / ");
}

function actionText(rule: ProjectRule, descriptors: RuleDescriptors | null): string {
  const actions = rule.definition.actions ?? [];
  return actions
    .map(
      (action) =>
        descriptors?.actions.find((entry) => entry.id === action.capability)?.label ??
        action.capability,
    )
    .join(" → ");
}

type WebhookEndpoint = {
  id: number;
  name: string;
  token?: string;
  enabled: boolean;
};

export default function AutomationRulesPanel({
  projectId,
  initialRules,
  canEdit,
  rulesApiBase,
  descriptorsUrl,
  runUrlBase,
  aiSuggestUrl,
  allowManualRun = true,
}: {
  projectId?: number;
  initialRules: ProjectRule[];
  canEdit: boolean;
  rulesApiBase?: string;
  descriptorsUrl?: string;
  runUrlBase?: string;
  aiSuggestUrl?: string;
  allowManualRun?: boolean;
}) {
  const apiBase = rulesApiBase ?? `/api/projects/${projectId}/rules`;
  const metaUrl =
    descriptorsUrl ?? `/api/projects/${projectId}/automation/descriptors`;
  const runsBase = runUrlBase ?? apiBase;
  const [rules, setRules] = useState(initialRules);
  const [descriptors, setDescriptors] = useState<RuleDescriptors | null>(null);
  const [builderRule, setBuilderRule] = useState<ProjectRule | null | undefined>(undefined);
  const [historyRule, setHistoryRule] = useState<ProjectRule | null>(null);
  const [runs, setRuns] = useState<RuleRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyRequest = useRef<AbortController | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const [manualRule, setManualRule] = useState<ProjectRule | null>(null);
  const [manualTaskId, setManualTaskId] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");
  const [manualExecution, setManualExecution] = useState<ManualRuleExecution | null>(null);
  const [completedManualEventId, setCompletedManualEventId] = useState<number | null>(null);
  const [manualPollingStopped, setManualPollingStopped] = useState(false);
  const manualRequest = useRef<AbortController | null>(null);
  const manualPollRequest = useRef<AbortController | null>(null);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [webhookName, setWebhookName] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookBusy, setWebhookBusy] = useState(false);

  useEffect(() => () => {
    historyRequest.current?.abort();
    manualRequest.current?.abort();
    manualPollRequest.current?.abort();
  }, []);

  const manualRuleId = manualRule?.id;
  const manualEventId = manualExecution?.event_id;
  const manualStatus = manualExecution?.status;
  useEffect(() => {
    if (!completedManualEventId) return;
    const controller = new AbortController();
    void api<{ rules: ProjectRule[] }>(apiBase, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setRules(data.rules); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiBase, completedManualEventId]);

  useEffect(() => {
    if (!manualRuleId || !manualEventId || manualStatus !== "queued" || manualPollingStopped) return;
    const controller = new AbortController();
    manualPollRequest.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<{ execution: ManualRuleExecution }>(
          `${apiBase}/${manualRuleId}/runs?event_id=${manualEventId}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setManualError("");
        setManualExecution(result.execution);
        if (result.execution.status !== "queued") {
          setCompletedManualEventId(result.execution.event_id);
          return;
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof ApiError && [400, 401, 403, 404, 409].includes(caught.status)) {
          setManualError("ルールの削除や権限の変更により実行結果を取得できません。実行履歴やアクセス権を確認してください。");
          setManualPollingStopped(true);
          return;
        }
        setManualError("実行結果を取得できません。確認を再試行しています。");
      }
      timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiBase, manualRuleId, manualEventId, manualStatus, manualPollingStopped]);

  const closeManual = () => {
    manualRequest.current?.abort();
    manualPollRequest.current?.abort();
    setManualRule(null);
    setManualExecution(null);
    setManualPollingStopped(false);
    setManualBusy(false);
  };

  const closeHistory = () => {
    historyRequest.current?.abort();
    setHistoryRule(null);
  };

  const statusValue =
    descriptors?.actions
      .find((action) => action.id === "task.set_status")
      ?.params.find((param) => param.name === "status")
      ?.options?.[0]?.value ?? "進行中";

  const presets = [
    {
      name: "新規タスクを進行中にする",
      description: "タスク作成時にStatusを進行中へ変更",
      definition: {
        version: 1 as const,
        triggers: [{ event: "task.created" as const }],
        conditions: [],
        actions: [
          { capability: "task.set_status", params: { status: String(statusValue) } },
        ],
      },
    },
    {
      name: "完了時にコメントする",
      description: "タスク完了時に完了メッセージを追加",
      definition: {
        version: 1 as const,
        triggers: [{ event: "task.completed" as const }],
        conditions: [],
        actions: [
          {
            capability: "task.add_comment",
            params: { body: "完了しました: {{task.name}}" },
          },
        ],
      },
    },
    {
      name: "期限超過時に通知する",
      description: "期日を過ぎたタスクにコメントで通知",
      definition: {
        version: 1 as const,
        triggers: [{ event: "task.overdue" as const, days: 0 }],
        conditions: [],
        actions: [
          {
            capability: "task.add_comment",
            params: { body: "期限を過ぎています: {{task.name}} ({{task.due_on}})" },
          },
        ],
      },
    },
    {
      name: "フォーム送信時に確認サブタスク",
      description: "フォーム送信で作成されたタスクに確認サブタスクを追加",
      definition: {
        version: 1 as const,
        triggers: [{ event: "form.submitted" as const }],
        conditions: [],
        actions: [
          {
            capability: "task.create_subtask",
            params: { name: "内容を確認する", due_offset_days: 1 },
          },
        ],
      },
    },
  ];

  const addPreset = async (preset: (typeof presets)[number]) => {
    if (presetBusy) return;
    setPresetBusy(true);
    try {
      await api(apiBase, "POST", {
        name: preset.name,
        description: preset.description,
        definition: preset.definition,
      });
      await loadRules();
      toast("テンプレートからルールを追加しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "ルールの追加に失敗しました");
    } finally {
      setPresetBusy(false);
    }
  };

  const loadRules = async () => {
    const res = await fetch(apiBase);
    if (res.ok) {
      const data = (await res.json()) as { rules: ProjectRule[] };
      setRules(data.rules);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(metaUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RuleDescriptors | null) => {
        if (!cancelled && data) setDescriptors(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [metaUrl]);

  useEffect(() => {
    if (!projectId || projectId <= 0) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/webhook-endpoints`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: { endpoints?: WebhookEndpoint[] } | null,
        ) => {
          if (!cancelled && data?.endpoints) setEndpoints(data.endpoints);
        },
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const createWebhook = async () => {
    if (!projectId || webhookName.trim() === "" || webhookSecret.trim() === "" || webhookBusy) return;
    setWebhookBusy(true);
    try {
      const result = await api<{
        endpoint: WebhookEndpoint;
      }>(`/api/projects/${projectId}/webhook-endpoints`, "POST", {
        name: webhookName.trim(),
        secret: webhookSecret.trim(),
      });
      setEndpoints((current) => [...current, result.endpoint]);
      setWebhookName("");
      setWebhookSecret("");
      toast("受信Webhookを作成しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "作成に失敗しました");
    } finally {
      setWebhookBusy(false);
    }
  };

  const removeWebhook = async (endpoint: { id: number; name: string }) => {
    if (!projectId || !(await confirmAction(`Webhook「${endpoint.name}」を削除しますか？`))) return;
    try {
      await api(`/api/projects/${projectId}/webhook-endpoints/${endpoint.id}`, "DELETE");
      setEndpoints((current) => current.filter((entry) => entry.id !== endpoint.id));
      toast("受信Webhookを削除しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "削除に失敗しました");
    }
  };

  const toggle = async (rule: ProjectRule) => {
    setBusyId(rule.id);
    try {
      await api(`${apiBase}/${rule.id}`, "PATCH", {
        enabled: !rule.enabled,
      });
      setRules((current) =>
        current.map((entry) => (entry.id === rule.id ? { ...entry, enabled: !entry.enabled } : entry)),
      );
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "更新に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (rule: ProjectRule) => {
    if (!(await confirmAction(`ルール「${rule.name}」を削除しますか？`))) return;
    setBusyId(rule.id);
    try {
      await api(`${apiBase}/${rule.id}`, "DELETE");
      setRules((current) => current.filter((entry) => entry.id !== rule.id));
      toast("ルールを削除しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "削除に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (rule: ProjectRule) => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistoryRule(rule);
    setRuns([]);
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await api<{ runs: RuleRun[] }>(`${runsBase}/${rule.id}/runs?limit=30`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setRuns(data.runs);
    } catch {
      if (!controller.signal.aborted) setHistoryError("実行履歴を取得できませんでした");
    } finally {
      if (!controller.signal.aborted) setHistoryLoading(false);
    }
  };

  const runManual = async () => {
    if (!manualRule || manualBusy || manualExecution?.status === "queued") return;
    const taskId = Number(manualTaskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      setManualError("有効なタスクIDを入力してください");
      return;
    }
    setManualBusy(true);
    setManualError("");
    setManualExecution(null);
    setManualPollingStopped(false);
    const controller = new AbortController();
    manualRequest.current = controller;
    try {
      const result = await api<ManualRuleExecution>(`${apiBase}/${manualRule.id}/run`, {
        method: "POST", body: { task_id: taskId }, signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setManualExecution(result);
        if (result.status !== "queued") setCompletedManualEventId(result.event_id);
      }
    } catch (caught) {
      if (!controller.signal.aborted) setManualError(caught instanceof Error ? caught.message : "実行に失敗しました");
    } finally {
      if (!controller.signal.aborted) setManualBusy(false);
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-secondary">
            イベントをきっかけに、条件を評価して複数のアクションを自動実行します。
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            ルールは所有者の権限で実行され、すべての実行が履歴に残ります。
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
          {projectId && projectId > 0 && <Link href={`/projects/${projectId}/rules/new`} data-automation-editor-add className="flex h-8 items-center rounded-md bg-accent px-3 text-[12px] text-on-accent hover:bg-accent-hover">＋ フローを作成</Link>}
          <button
            type="button"
            data-customize-automation-add
            onClick={() => setBuilderRule(null)}
            disabled={!descriptors}
            className="flex h-8 shrink-0 items-center rounded-md border border-line bg-surface px-3 text-[12px] text-secondary hover:bg-hover disabled:opacity-50"
          >
            ＋ ルール
          </button>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-line bg-surface-subtle p-3">
        <div className="text-[11px] font-semibold text-secondary">クイックテンプレート</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => void addPreset(preset)}
              disabled={!canEdit || presetBusy || !descriptors}
              title={preset.description}
              className="rounded-full border border-neutral-200 bg-surface px-2.5 py-1 text-[11px] text-neutral-700 hover:border-[#4075cf] hover:text-[#2c60b8] disabled:opacity-50"
            >
              ＋ {preset.name}
            </button>
          ))}
        </div>
      </div>

      {canEdit && projectId && projectId > 0 && <RuleDraftList projectId={projectId} />}

      {projectId && projectId > 0 && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-3">
          <div className="text-[11px] font-semibold text-secondary">受信Webhook</div>
          <p className="mt-0.5 text-[10px] text-subtle">
            外部システムからPOSTすると「外部Webhookを受信したとき」トリガーが発火します。
          </p>
          {endpoints.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {endpoints.map((endpoint) => {
                const path = endpoint.enabled && endpoint.token
                  ? `/api/automation/webhook/${endpoint.token}`
                  : null;
                return (
                  <div
                    key={endpoint.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-line-subtle bg-surface-subtle px-2 py-1.5"
                  >
                    <span className="text-[11px] font-medium text-secondary">{endpoint.name}</span>
                    {!endpoint.enabled && <span className="text-[10px] text-muted">無効</span>}
                    {path && (
                      <>
                        <code className="min-w-0 flex-1 truncate text-[10px] text-muted">
                          {path}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(`${location.origin}${path}`);
                            toast("Webhook URLをコピーしました");
                          }}
                          className="text-[10px] text-accent-text hover:underline"
                        >
                          コピー
                        </button>
                      </>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => void removeWebhook(endpoint)}
                        aria-label={`${endpoint.name}を削除`}
                        className="text-neutral-400 hover:text-rose-600"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {canEdit && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={webhookName}
                onChange={(event) => setWebhookName(event.target.value)}
                placeholder="Webhook名"
                className="h-8 min-w-[140px] flex-1 rounded-md border border-line px-2 text-[11px] outline-none focus:border-accent"
              />
              <input
                type="password"
                value={webhookSecret}
                onChange={(event) => setWebhookSecret(event.target.value)}
                placeholder="署名シークレット（必須）"
                maxLength={200}
                className="h-8 min-w-[160px] flex-1 rounded-md border border-line px-2 text-[11px] outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void createWebhook()}
                disabled={webhookBusy || webhookName.trim() === "" || webhookSecret.trim() === ""}
                className="h-8 rounded-md border border-line px-3 text-[11px] text-secondary hover:bg-hover disabled:opacity-50"
              >
                ＋ 作成
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
            ルールはまだありません。
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              data-automation-rule={rule.id}
              className="rounded-lg border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-text">{rule.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        rule.enabled ? "bg-success-soft text-green-800" : "bg-surface-muted text-muted"
                      }`}
                    >
                      {rule.enabled ? "有効" : "無効"}
                    </span>
                    {rule.last_run_status && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          rule.last_run_status === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        最終実行: {rule.last_run_status}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {triggerText(rule, descriptors)}
                    {actionText(rule, descriptors) && ` → ${actionText(rule, descriptors)}`}
                  </div>
                  {rule.description && (
                    <div className="mt-0.5 text-[10px] text-subtle">{rule.description}</div>
                  )}
                  <div className="mt-1 text-[10px] text-subtle">
                    所有者: {rule.owner_name ?? "不明"} ・ v{rule.version}
                    {rule.last_run_at ? " ・ 実行履歴あり" : ""}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {projectId && projectId > 0 && <Link href={`/projects/${projectId}/rules/${rule.id}`} data-automation-editor-link className="flex h-7 items-center rounded-md border border-accent-line bg-[#eff4fd] px-2 text-[11px] text-accent-text hover:bg-blue-100">フロー編集</Link>}
                    <button
                      type="button"
                      onClick={() => setBuilderRule(rule)}
                      className="h-7 rounded-md border border-line px-2 text-[11px] text-secondary hover:bg-hover"
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() => void openHistory(rule)}
                      className="h-7 rounded-md border border-line px-2 text-[11px] text-secondary hover:bg-hover"
                    >
                      履歴
                    </button>
                    {allowManualRun && rule.enabled && rule.definition.triggers.some((trigger) => trigger.event === "task.manual_rule") && (
                      <button
                        type="button"
                        onClick={() => {
                          setManualRule(rule);
                          setManualTaskId("");
                          setManualError("");
                          setManualExecution(null);
                          setManualPollingStopped(false);
                        }}
                        className="h-7 rounded-md border border-line px-2 text-[11px] text-secondary hover:bg-hover"
                      >
                        実行
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void toggle(rule)}
                      disabled={busyId === rule.id}
                      className="h-7 rounded-md border border-line px-2 text-[11px] text-secondary hover:bg-hover disabled:opacity-50"
                    >
                      {rule.enabled ? "無効化" : "有効化"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(rule)}
                      disabled={busyId === rule.id}
                      aria-label={`${rule.name}を削除`}
                      className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
              {rule.definition.branches && rule.definition.branches.length > 0 && (
                <div className="mt-2 rounded bg-surface-subtle px-2 py-1 text-[10px] text-muted">
                  条件分岐 {rule.definition.branches.length} パス
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {builderRule !== undefined && descriptors && (
        <AutomationRuleBuilder
          projectId={projectId}
          ruleApiBase={apiBase}
          aiSuggestUrl={aiSuggestUrl}
          descriptors={descriptors}
          rule={builderRule}
          onClose={() => setBuilderRule(undefined)}
          onSaved={() => void loadRules()}
        />
      )}

      {manualRule && (
        <Dialog
          open
          onClose={closeManual}
          title={`${manualRule.name} を手動実行`}
          panelClassName="w-[min(460px,94vw)] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        >
          <div className="p-5">
            <h3 className="text-[15px] font-semibold text-text">手動実行</h3>
            <p className="mt-1 text-[11px] text-muted">
              ルールのトリガーに「手動で実行」が含まれている必要があります。
            </p>
            <label className="mt-3 block text-[11px] font-medium text-secondary">
              対象タスクID
              <input
                value={manualTaskId}
                onChange={(event) => setManualTaskId(event.target.value)}
                inputMode="numeric"
                disabled={manualBusy || manualExecution?.status === "queued"}
                placeholder="例: 123"
                className="mt-1 h-9 w-full rounded-md border border-line px-2 text-[13px] outline-none focus:border-accent"
              />
            </label>
            {manualError && <p className="mt-2 text-[11px] text-rose-600">{manualError}</p>}
            {manualExecution && (
              <p role="status" className="mt-2 text-[12px] text-secondary">
                {manualExecution.status === "success" ? "ルールの実行が成功しました。"
                  : manualExecution.status === "failed" ? `ルールの実行に失敗しました。${manualExecution.error ?? "実行履歴を確認してください。"}`
                    : manualExecution.status === "skipped" ? "対象や条件により、ルールの実行をスキップしました。"
                      : manualPollingStopped ? "実行結果の確認を終了しました。"
                        : "実行待ちです。結果を確認しています。"}
              </p>
            )}
            {(manualBusy || manualExecution?.status === "queued") && (
              <p className="mt-2 text-[11px] text-muted">閉じても開始済みの処理は継続します。</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeManual}
                className="h-8 rounded-md border border-line px-3 text-[12px] text-secondary hover:bg-hover"
              >
                閉じる
              </button>
              <button
                type="button"
                onClick={() => void runManual()}
                disabled={manualBusy || manualExecution?.status === "queued"}
                className="h-8 rounded-md bg-accent px-4 text-[12px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                {manualBusy ? "実行中…" : manualPollingStopped ? "結果未確認" : manualExecution?.status === "queued" ? "実行待ち…" : "実行"}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {historyRule && (
        <Dialog
          open
          onClose={closeHistory}
          title={`${historyRule.name} の実行履歴`}
          panelClassName="flex max-h-[80vh] w-[min(680px,96vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line-subtle px-5 py-4">
            <div>
              <h3 className="text-[16px] font-semibold text-text">実行履歴</h3>
              <p className="text-[11px] text-muted">{historyRule.name}</p>
            </div>
            <button
              type="button"
              onClick={closeHistory}
              aria-label="閉じる"
              className="flex h-7 w-7 items-center justify-center rounded-md text-xl text-muted hover:bg-hover"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {historyLoading ? (
              <p role="status" className="py-8 text-center text-[12px] text-subtle">実行履歴を読み込んでいます…</p>
            ) : historyError ? (
              <p role="alert" className="py-8 text-center text-[12px] text-rose-600">{historyError}</p>
            ) : runs.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-subtle">実行履歴はありません。</p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-lg border border-line p-3 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          run.status === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : run.status === "failed"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-surface-muted text-secondary"
                        }`}
                      >
                        {run.status}
                      </span>
                      <span className="text-muted">{run.started_at}</span>
                      <span className="text-subtle">
                        {run.actions_succeeded}/{run.actions_total} アクション成功
                      </span>
                      {run.error && <span className="text-rose-600">{run.error}</span>}
                    </div>
                    {run.details.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[10px] text-muted">
                        {run.details.map((detail) => (
                          <li key={`${run.id}-${detail.index}`}>
                            {detail.status === "success" ? "✓" : "×"}{" "}
                            {descriptors?.actions.find((entry) => entry.id === detail.capability)?.label ??
                              detail.capability}
                            {detail.error ? `: ${detail.error}` : ""}
                            {detail.attempts && detail.attempts > 1 ? `（${detail.attempts}回試行）` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
