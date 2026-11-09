"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import type { ProjectRule, RuleRun } from "@/lib/automation/types";
import { confirmAction, toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";
import AutomationRuleBuilder from "./AutomationRuleBuilder";

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

export default function AutomationRulesPanel({
  projectId,
  initialRules,
  canEdit,
}: {
  projectId: number;
  initialRules: ProjectRule[];
  canEdit: boolean;
}) {
  const [rules, setRules] = useState(initialRules);
  const [descriptors, setDescriptors] = useState<RuleDescriptors | null>(null);
  const [builderRule, setBuilderRule] = useState<ProjectRule | null | undefined>(undefined);
  const [historyRule, setHistoryRule] = useState<ProjectRule | null>(null);
  const [runs, setRuns] = useState<RuleRun[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const [manualRule, setManualRule] = useState<ProjectRule | null>(null);
  const [manualTaskId, setManualTaskId] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");

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
      await api(`/api/projects/${projectId}/rules`, "POST", {
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
    const res = await fetch(`/api/projects/${projectId}/rules`);
    if (res.ok) {
      const data = (await res.json()) as { rules: ProjectRule[] };
      setRules(data.rules);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/automation/descriptors`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RuleDescriptors | null) => {
        if (!cancelled && data) setDescriptors(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const toggle = async (rule: ProjectRule) => {
    setBusyId(rule.id);
    try {
      await api(`/api/projects/${projectId}/rules/${rule.id}`, "PATCH", {
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
      await api(`/api/projects/${projectId}/rules/${rule.id}`, "DELETE");
      setRules((current) => current.filter((entry) => entry.id !== rule.id));
      toast("ルールを削除しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "削除に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (rule: ProjectRule) => {
    setHistoryRule(rule);
    setRuns([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/rules/${rule.id}/runs?limit=30`);
      if (res.ok) {
        const data = (await res.json()) as { runs: RuleRun[] };
        setRuns(data.runs);
      }
    } catch {
      toast("実行履歴を取得できませんでした");
    }
  };

  const runManual = async () => {
    if (!manualRule || manualBusy) return;
    const taskId = Number(manualTaskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      setManualError("有効なタスクIDを入力してください");
      return;
    }
    setManualBusy(true);
    setManualError("");
    try {
      await api(`/api/projects/${projectId}/rules/${manualRule.id}/run`, "POST", {
        task_id: taskId,
      });
      toast("ルールを手動実行しました");
      setManualRule(null);
      setManualTaskId("");
      await loadRules();
    } catch (caught) {
      setManualError(caught instanceof Error ? caught.message : "実行に失敗しました");
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-neutral-600">
            イベントをきっかけに、条件を評価して複数のアクションを自動実行します。
          </p>
          <p className="mt-1 text-[11px] text-neutral-400">
            ルールは所有者の権限で実行され、すべての実行が履歴に残ります。
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            data-customize-automation-add
            onClick={() => setBuilderRule(null)}
            disabled={!descriptors}
            className="flex h-8 shrink-0 items-center rounded-md border border-neutral-200 bg-white px-3 text-[12px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            ＋ ルール
          </button>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <div className="text-[11px] font-semibold text-neutral-700">クイックテンプレート</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => void addPreset(preset)}
              disabled={!canEdit || presetBusy || !descriptors}
              title={preset.description}
              className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] text-neutral-700 hover:border-[#4075cf] hover:text-[#2c60b8] disabled:opacity-50"
            >
              ＋ {preset.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-10 text-center text-[13px] text-neutral-500">
            ルールはまだありません。
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              data-automation-rule={rule.id}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-neutral-900">{rule.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        rule.enabled ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-500"
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
                  <div className="mt-1 text-[11px] text-neutral-500">
                    {triggerText(rule, descriptors)}
                    {actionText(rule, descriptors) && ` → ${actionText(rule, descriptors)}`}
                  </div>
                  {rule.description && (
                    <div className="mt-0.5 text-[10px] text-neutral-400">{rule.description}</div>
                  )}
                  <div className="mt-1 text-[10px] text-neutral-400">
                    所有者: {rule.owner_name ?? "不明"} ・ v{rule.version}
                    {rule.last_run_at ? " ・ 実行履歴あり" : ""}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setBuilderRule(rule)}
                      className="h-7 rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-700 hover:bg-neutral-50"
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() => void openHistory(rule)}
                      className="h-7 rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-700 hover:bg-neutral-50"
                    >
                      履歴
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setManualRule(rule);
                        setManualTaskId("");
                        setManualError("");
                      }}
                      className="h-7 rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-700 hover:bg-neutral-50"
                    >
                      実行
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggle(rule)}
                      disabled={busyId === rule.id}
                      className="h-7 rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
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
                <div className="mt-2 rounded bg-neutral-50 px-2 py-1 text-[10px] text-neutral-500">
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
          descriptors={descriptors}
          rule={builderRule}
          onClose={() => setBuilderRule(undefined)}
          onSaved={() => void loadRules()}
        />
      )}

      {manualRule && (
        <Dialog
          open
          onClose={() => setManualRule(null)}
          title={`${manualRule.name} を手動実行`}
          panelClassName="w-[min(460px,94vw)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
        >
          <div className="p-5">
            <h3 className="text-[15px] font-semibold text-neutral-900">手動実行</h3>
            <p className="mt-1 text-[11px] text-neutral-500">
              ルールのトリガーに「手動で実行」が含まれている必要があります。
            </p>
            <label className="mt-3 block text-[11px] font-medium text-neutral-600">
              対象タスクID
              <input
                value={manualTaskId}
                onChange={(event) => setManualTaskId(event.target.value)}
                inputMode="numeric"
                placeholder="例: 123"
                className="mt-1 h-9 w-full rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8]"
              />
            </label>
            {manualError && <p className="mt-2 text-[11px] text-rose-600">{manualError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setManualRule(null)}
                className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] text-neutral-700 hover:bg-neutral-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void runManual()}
                disabled={manualBusy}
                className="h-8 rounded-md bg-[#2c60b8] px-4 text-[12px] font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
              >
                {manualBusy ? "実行中…" : "実行"}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {historyRule && (
        <Dialog
          open
          onClose={() => setHistoryRule(null)}
          title={`${historyRule.name} の実行履歴`}
          panelClassName="flex max-h-[80vh] w-[min(680px,96vw)] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
            <div>
              <h3 className="text-[16px] font-semibold text-neutral-900">実行履歴</h3>
              <p className="text-[11px] text-neutral-500">{historyRule.name}</p>
            </div>
            <button
              type="button"
              onClick={() => setHistoryRule(null)}
              aria-label="閉じる"
              className="flex h-7 w-7 items-center justify-center rounded-md text-xl text-neutral-500 hover:bg-neutral-100"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {runs.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-neutral-400">実行履歴はありません。</p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-lg border border-neutral-200 p-3 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          run.status === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : run.status === "failed"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {run.status}
                      </span>
                      <span className="text-neutral-500">{run.started_at}</span>
                      <span className="text-neutral-400">
                        {run.actions_succeeded}/{run.actions_total} アクション成功
                      </span>
                      {run.error && <span className="text-rose-600">{run.error}</span>}
                    </div>
                    {run.details.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[10px] text-neutral-500">
                        {run.details.map((detail) => (
                          <li key={`${run.id}-${detail.index}`}>
                            {detail.status === "success" ? "✓" : "×"}{" "}
                            {descriptors?.actions.find((entry) => entry.id === detail.capability)?.label ??
                              detail.capability}
                            {detail.error ? `: ${detail.error}` : ""}
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
