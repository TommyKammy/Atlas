"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type {
  DescriptorOption,
  DescriptorParam,
  RuleDescriptors,
} from "@/lib/automation/descriptors";
import type {
  ProjectRule,
  RuleAction,
  RuleCondition,
  RulePath,
  RuleTrigger,
} from "@/lib/automation/types";
import { toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";

const inputClass =
  "mt-1 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[12px] outline-none focus:border-[#2c60b8]";
const areaClass =
  "mt-1 min-h-[68px] w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-[#2c60b8]";

function defaultParams(paramDefs: DescriptorParam[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const param of paramDefs) {
    if (param.type === "select" && param.options && param.options.length > 0) {
      result[param.name] = param.options[0].value;
    } else if (param.type === "number") {
      result[param.name] = "";
    } else {
      result[param.name] = "";
    }
  }
  return result;
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: DescriptorParam;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = (
    <span className="block text-[11px] font-medium text-neutral-600">
      {param.label}
      {param.required ? <span className="ml-0.5 text-rose-500">*</span> : null}
    </span>
  );
  if (param.type === "textarea") {
    return (
      <label className="block">
        {label}
        <textarea
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          placeholder={param.placeholder}
          className={areaClass}
        />
        {param.help && <span className="mt-0.5 block text-[10px] text-neutral-400">{param.help}</span>}
      </label>
    );
  }
  if (param.type === "select") {
    return (
      <label className="block">
        {label}
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          {!param.required && <option value="">指定なし</option>}
          {(param.options ?? []).map((option: DescriptorOption) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="block">
      {label}
      <input
        type={param.type === "number" ? "number" : param.type === "date" ? "date" : "text"}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        placeholder={param.placeholder}
        className={inputClass}
      />
      {param.help && <span className="mt-0.5 block text-[10px] text-neutral-400">{param.help}</span>}
    </label>
  );
}

export default function AutomationRuleBuilder({
  projectId,
  descriptors,
  rule,
  ruleApiBase,
  aiSuggestUrl,
  onClose,
  onSaved,
}: {
  projectId?: number;
  descriptors: RuleDescriptors;
  rule: ProjectRule | null;
  ruleApiBase?: string;
  aiSuggestUrl?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const apiBase = ruleApiBase ?? `/api/projects/${projectId}/rules`;
  const suggestUrl =
    aiSuggestUrl ?? `/api/projects/${projectId}/rules/ai-suggest`;
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [triggers, setTriggers] = useState<RuleTrigger[]>(
    rule?.definition.triggers.length
      ? rule.definition.triggers
      : [{ event: "task.created" }],
  );
  const [conditions, setConditions] = useState<RuleCondition[]>(
    rule?.definition.conditions ?? [],
  );
  const [actions, setActions] = useState<RuleAction[]>(
    rule?.definition.actions?.length
      ? rule.definition.actions
      : (() => {
          const first = descriptors.actions[0];
          return first ? [{ capability: first.id, params: defaultParams(first.params) }] : [];
        })(),
  );
  const [useBranches, setUseBranches] = useState(Boolean(rule?.definition.branches?.length));
  const [branches, setBranches] = useState<RulePath[]>(rule?.definition.branches ?? []);
  const [aiPrompt, setAiPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const actionDescriptor = (id: string) => descriptors.actions.find((action) => action.id === id);

  const addTrigger = () => {
    if (triggers.length >= descriptors.limits.triggersPerRule) return;
    setTriggers((current) => [...current, { event: "task.created" }]);
  };
  const addCondition = () => {
    if (conditions.length >= descriptors.limits.conditionsPerPath) return;
    const field = descriptors.conditionFields[0];
    setConditions((current) => [
      ...current,
      { field: field?.id ?? "task.name", op: "eq", value: "" },
    ]);
  };
  const addAction = () => {
    if (actions.length >= descriptors.limits.actionsPerRule) return;
    const first = descriptors.actions[0];
    if (!first) return;
    setActions((current) => [
      ...current,
      { capability: first.id, params: defaultParams(first.params) },
    ]);
  };

  const blankAction = (): RuleAction => {
    const first = descriptors.actions[0];
    return first ? { capability: first.id, params: defaultParams(first.params) } : { capability: "", params: {} };
  };

  const toggleBranches = () => {
    if (useBranches) {
      const first = branches[0];
      if (first) setActions(first.actions);
      setBranches([]);
      setUseBranches(false);
      return;
    }
    if (branches.length === 0) {
      setBranches([
        {
          name: "パス1",
          conditions: [],
          actions: actions.length > 0 ? actions : [blankAction()],
        },
      ]);
      setActions([]);
    }
    setUseBranches(true);
  };

  const addBranch = () => {
    setBranches((current) => [
      ...current,
      {
        name: `パス${current.length + 1}`,
        conditions: [],
        actions: [blankAction()],
      },
    ]);
  };

  const setAction = (index: number, capability: string) => {
    const descriptor = actionDescriptor(capability);
    setActions((current) =>
      current.map((action, actionIndex) =>
        actionIndex === index
          ? { capability, params: descriptor ? defaultParams(descriptor.params) : {} }
          : action,
      ),
    );
  };

  const suggest = async () => {
    if (aiPrompt.trim() === "") return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        name: string;
        description: string;
        definition: {
          triggers: RuleTrigger[];
          conditions?: RuleCondition[];
          actions?: RuleAction[];
        };
      }>(suggestUrl, "POST", { prompt: aiPrompt.trim() });
      setName(result.name);
      setDescription(result.description);
      setTriggers(result.definition.triggers);
      setConditions(result.definition.conditions ?? []);
      setActions(result.definition.actions ?? []);
      toast("AIアシストがルール案を作成しました");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提案の作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy) return;
    if (name.trim() === "") {
      setError("ルール名を入力してください");
      return;
    }
    if (triggers.length === 0) {
      setError("トリガーを1つ以上設定してください");
      return;
    }
    if (useBranches) {
      if (branches.length === 0 || branches.some((branch) => branch.actions.length === 0)) {
        setError("各パスにアクションを1つ以上設定してください");
        return;
      }
    } else if (actions.length === 0) {
      setError("アクションを1つ以上設定してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        definition: {
          version: 1 as const,
          triggers,
          conditions,
          ...(useBranches ? { branches } : { actions }),
        },
      };
      if (rule) {
        await api(`${apiBase}/${rule.id}`, "PATCH", payload);
      } else {
        await api(apiBase, "POST", payload);
      }
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={rule ? "ルールを編集" : "ルールを作成"}
      panelClassName="flex max-h-[92vh] w-[min(760px,96vw)] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
        <div>
          <h3 className="text-[17px] font-semibold text-neutral-900">
            {rule ? "ルールを編集" : "ルールを作成"}
          </h3>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            トリガー、条件、複数アクションを組み合わせます。
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="flex h-7 w-7 items-center justify-center rounded-md text-xl text-neutral-500 hover:bg-neutral-100"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="rounded-lg border border-[#dbe7fb] bg-[#f5f9ff] p-3">
          <div className="text-[12px] font-semibold text-[#24529c]">AIアシスト</div>
          <div className="mt-2 flex gap-2">
            <input
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="例: 新規タスクを進行中にして担当者を田中さんにする"
              className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[12px] outline-none focus:border-[#2c60b8]"
            />
            <button
              type="button"
              onClick={() => void suggest()}
              disabled={busy || aiPrompt.trim() === ""}
              className="h-8 shrink-0 rounded-md bg-[#2c60b8] px-3 text-[12px] font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
            >
              提案
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-medium text-neutral-600">
            ルール名
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例: 新規タスクを進行中にする"
              className={inputClass}
            />
          </label>
          <label className="block text-[11px] font-medium text-neutral-600">
            説明（任意）
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="このルールの目的"
              className={inputClass}
            />
          </label>
        </div>

        <section className="mt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-neutral-800">
              トリガー <span className="text-neutral-400">({triggers.length})</span>
            </h4>
            <button
              type="button"
              onClick={addTrigger}
              disabled={triggers.length >= descriptors.limits.triggersPerRule}
              className="text-[11px] text-[#2c60b8] hover:underline disabled:text-neutral-300"
            >
              ＋ トリガーを追加
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {triggers.map((trigger, index) => {
              const descriptor = descriptors.triggers.find(
                (entry) => entry.id === trigger.event,
              );
              return (
                <div
                  key={`trigger-${index}`}
                  className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-2.5"
                >
                  <label className="min-w-[220px] flex-1 text-[11px] text-neutral-600">
                    きっかけ
                    <select
                      value={trigger.event}
                      onChange={(event) => {
                        const next = event.target.value as RuleTrigger["event"];
                        setTriggers((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { event: next, days: trigger.days } : entry,
                          ),
                        );
                      }}
                      className={inputClass}
                    >
                      {descriptors.triggers.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {descriptor?.days && (
                    <label className="w-32 text-[11px] text-neutral-600">
                      {descriptor.days.label}
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={trigger.days ?? descriptor.days.default}
                        onChange={(event) =>
                          setTriggers((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, days: Number(event.target.value) }
                                : entry,
                            ),
                          )
                        }
                        className={inputClass}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    aria-label="トリガーを削除"
                    onClick={() =>
                      setTriggers((current) => current.filter((_, entryIndex) => entryIndex !== index))
                    }
                    className="mb-0.5 flex h-8 w-8 items-center justify-center rounded text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-neutral-800">
              条件（すべて満たす） <span className="text-neutral-400">({conditions.length})</span>
            </h4>
            <button
              type="button"
              onClick={addCondition}
              className="text-[11px] text-[#2c60b8] hover:underline"
            >
              ＋ 条件を追加
            </button>
          </div>
          {conditions.length === 0 ? (
            <p className="mt-2 rounded-md border border-dashed border-neutral-200 px-3 py-2 text-[11px] text-neutral-400">
              条件なしで、トリガー発生時に毎回実行します。
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {conditions.map((condition, index) => {
                const field = descriptors.conditionFields.find(
                  (entry) => entry.id === condition.field,
                );
                const needsValue = condition.op !== "is_empty" && condition.op !== "is_not_empty";
                return (
                  <div
                    key={`condition-${index}`}
                    className="grid grid-cols-1 gap-2 rounded-lg border border-neutral-200 bg-white p-2.5 sm:grid-cols-[1.2fr_0.9fr_1fr_auto]"
                  >
                    <label className="text-[11px] text-neutral-600">
                      フィールド
                      <select
                        value={condition.field}
                        onChange={(event) =>
                          setConditions((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, field: event.target.value, value: "" }
                                : entry,
                            ),
                          )
                        }
                        className={inputClass}
                      >
                        {descriptors.conditionFields.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-neutral-600">
                      演算子
                      <select
                        value={condition.op}
                        onChange={(event) =>
                          setConditions((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    op: event.target.value as RuleCondition["op"],
                                  }
                                : entry,
                            ),
                          )
                        }
                        className={inputClass}
                      >
                        {descriptors.operators.map((operator) => (
                          <option key={operator.value} value={operator.value}>
                            {operator.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="text-[11px] text-neutral-600">
                      <span className="block font-medium">値</span>
                      {!needsValue ? (
                        <span className="mt-1 flex h-8 items-center text-[11px] text-neutral-400">
                          値は不要です
                        </span>
                      ) : field?.options ? (
                        <select
                          value={String(condition.value ?? "")}
                          onChange={(event) =>
                            setConditions((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, value: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          className={inputClass}
                        >
                          <option value="">選択…</option>
                          {field.options.map((option) => (
                            <option key={String(option.value)} value={String(option.value)}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={
                            field?.type === "number"
                              ? "number"
                              : field?.type === "date"
                                ? "date"
                                : "text"
                          }
                          value={String(condition.value ?? "")}
                          onChange={(event) =>
                            setConditions((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, value: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          className={inputClass}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="条件を削除"
                      onClick={() =>
                        setConditions((current) =>
                          current.filter((_, entryIndex) => entryIndex !== index),
                        )
                      }
                      className="mt-5 flex h-8 w-8 items-center justify-center rounded text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <label className="mt-5 flex items-center gap-2 text-[12px] font-medium text-neutral-700">
          <input
            type="checkbox"
            checked={useBranches}
            onChange={toggleBranches}
            className="h-3.5 w-3.5"
          />
          条件分岐を使う（elseパス対応）
        </label>

        {useBranches && (
          <section className="mt-3 space-y-3">
            {branches.map((branch, branchIndex) => (
              <div
                key={`branch-${branchIndex}`}
                className="rounded-lg border border-neutral-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[180px] flex-1 text-[11px] text-neutral-600">
                    パス名
                    <input
                      value={branch.name}
                      onChange={(event) =>
                        setBranches((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === branchIndex ? { ...entry, name: event.target.value } : entry,
                          ),
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="mb-1 flex items-center gap-1 text-[11px] text-neutral-600">
                    <input
                      type="checkbox"
                      checked={branch.else === true}
                      onChange={(event) =>
                        setBranches((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === branchIndex
                              ? { ...entry, else: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                      className="h-3.5 w-3.5"
                    />
                    elseパス
                  </label>
                  <button
                    type="button"
                    aria-label="パスを削除"
                    onClick={() =>
                      setBranches((current) => current.filter((_, entryIndex) => entryIndex !== branchIndex))
                    }
                    className="mb-0.5 flex h-8 w-8 items-center justify-center rounded text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    ×
                  </button>
                </div>

                {branch.else !== true && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-neutral-600">条件</span>
                      <button
                        type="button"
                        onClick={() =>
                          setBranches((current) =>
                            current.map((entry, entryIndex) => {
                              if (entryIndex !== branchIndex) return entry;
                              const field = descriptors.conditionFields[0];
                              return {
                                ...entry,
                                conditions: [
                                  ...entry.conditions,
                                  { field: field?.id ?? "task.name", op: "eq", value: "" },
                                ],
                              };
                            }),
                          )
                        }
                        className="text-[10px] text-[#2c60b8] hover:underline"
                      >
                        ＋ 条件
                      </button>
                    </div>
                    <div className="mt-1 space-y-1.5">
                      {branch.conditions.map((condition, conditionIndex) => {
                        const field = descriptors.conditionFields.find(
                          (entry) => entry.id === condition.field,
                        );
                        const needsValue =
                          condition.op !== "is_empty" && condition.op !== "is_not_empty";
                        return (
                          <div
                            key={`branch-${branchIndex}-condition-${conditionIndex}`}
                            className="grid grid-cols-1 gap-1.5 rounded border border-neutral-100 bg-neutral-50 p-2 sm:grid-cols-[1.2fr_0.9fr_1fr_auto]"
                          >
                            <select
                              value={condition.field}
                              onChange={(event) =>
                                setBranches((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === branchIndex
                                      ? {
                                          ...entry,
                                          conditions: entry.conditions.map((item, itemIndex) =>
                                            itemIndex === conditionIndex
                                              ? { ...item, field: event.target.value, value: "" }
                                              : item,
                                          ),
                                        }
                                      : entry,
                                  ),
                                )
                              }
                              className={inputClass}
                            >
                              {descriptors.conditionFields.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={condition.op}
                              onChange={(event) =>
                                setBranches((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === branchIndex
                                      ? {
                                          ...entry,
                                          conditions: entry.conditions.map((item, itemIndex) =>
                                            itemIndex === conditionIndex
                                              ? {
                                                  ...item,
                                                  op: event.target.value as RuleCondition["op"],
                                                }
                                              : item,
                                          ),
                                        }
                                      : entry,
                                  ),
                                )
                              }
                              className={inputClass}
                            >
                              {descriptors.operators.map((operator) => (
                                <option key={operator.value} value={operator.value}>
                                  {operator.label}
                                </option>
                              ))}
                            </select>
                            {!needsValue ? (
                              <span className="flex h-8 items-center text-[10px] text-neutral-400">
                                値は不要
                              </span>
                            ) : field?.options ? (
                              <select
                                value={String(condition.value ?? "")}
                                onChange={(event) =>
                                  setBranches((current) =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === branchIndex
                                        ? {
                                            ...entry,
                                            conditions: entry.conditions.map((item, itemIndex) =>
                                              itemIndex === conditionIndex
                                                ? { ...item, value: event.target.value }
                                                : item,
                                            ),
                                          }
                                        : entry,
                                    ),
                                  )
                                }
                                className={inputClass}
                              >
                                <option value="">選択…</option>
                                {field.options.map((option) => (
                                  <option key={String(option.value)} value={String(option.value)}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={field?.type === "number" ? "number" : field?.type === "date" ? "date" : "text"}
                                value={String(condition.value ?? "")}
                                onChange={(event) =>
                                  setBranches((current) =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === branchIndex
                                        ? {
                                            ...entry,
                                            conditions: entry.conditions.map((item, itemIndex) =>
                                              itemIndex === conditionIndex
                                                ? { ...item, value: event.target.value }
                                                : item,
                                            ),
                                          }
                                        : entry,
                                    ),
                                  )
                                }
                                className={inputClass}
                              />
                            )}
                            <button
                              type="button"
                              aria-label="条件を削除"
                              onClick={() =>
                                setBranches((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === branchIndex
                                      ? {
                                          ...entry,
                                          conditions: entry.conditions.filter(
                                            (_, itemIndex) => itemIndex !== conditionIndex,
                                          ),
                                        }
                                      : entry,
                                  ),
                                )
                              }
                              className="flex h-8 w-8 items-center justify-center rounded text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-neutral-600">アクション</span>
                    <button
                      type="button"
                      onClick={() =>
                        setBranches((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === branchIndex
                              ? { ...entry, actions: [...entry.actions, blankAction()] }
                              : entry,
                          ),
                        )
                      }
                      className="text-[10px] text-[#2c60b8] hover:underline"
                    >
                      ＋ アクション
                    </button>
                  </div>
                  <div className="mt-1 space-y-1.5">
                    {branch.actions.map((action, actionIndex) => {
                      const descriptor = actionDescriptor(action.capability);
                      return (
                        <div
                          key={`branch-${branchIndex}-action-${actionIndex}`}
                          className="rounded border border-neutral-100 bg-neutral-50 p-2"
                        >
                          <div className="flex items-end gap-2">
                            <select
                              value={action.capability}
                              onChange={(event) => {
                                const next = actionDescriptor(event.target.value);
                                setBranches((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === branchIndex
                                      ? {
                                          ...entry,
                                          actions: entry.actions.map((item, itemIndex) =>
                                            itemIndex === actionIndex
                                              ? {
                                                  capability: event.target.value,
                                                  params: next ? defaultParams(next.params) : {},
                                                }
                                              : item,
                                          ),
                                        }
                                      : entry,
                                  ),
                                );
                              }}
                              className={inputClass}
                            >
                              {descriptors.actions.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              aria-label="アクションを削除"
                              onClick={() =>
                                setBranches((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === branchIndex
                                      ? {
                                          ...entry,
                                          actions: entry.actions.filter(
                                            (_, itemIndex) => itemIndex !== actionIndex,
                                          ),
                                        }
                                      : entry,
                                  ),
                                )
                              }
                              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              ×
                            </button>
                          </div>
                          {descriptor && descriptor.params.length > 0 && (
                            <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {descriptor.params.map((param) => (
                                <ParamField
                                  key={param.name}
                                  param={param}
                                  value={action.params[param.name]}
                                  onChange={(value) =>
                                    setBranches((current) =>
                                      current.map((entry, entryIndex) =>
                                        entryIndex === branchIndex
                                          ? {
                                              ...entry,
                                              actions: entry.actions.map((item, itemIndex) =>
                                                itemIndex === actionIndex
                                                  ? {
                                                      ...item,
                                                      params: { ...item.params, [param.name]: value },
                                                    }
                                                  : item,
                                              ),
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addBranch}
              className="h-8 rounded-md border border-dashed border-neutral-300 px-3 text-[11px] text-[#2c60b8] hover:bg-[#f5f9ff]"
            >
              ＋ パスを追加
            </button>
          </section>
        )}

        {!useBranches && (
        <section className="mt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-neutral-800">
              アクション <span className="text-neutral-400">({actions.length})</span>
            </h4>
            <button
              type="button"
              onClick={addAction}
              disabled={actions.length >= descriptors.limits.actionsPerRule}
              className="text-[11px] text-[#2c60b8] hover:underline disabled:text-neutral-300"
            >
              ＋ アクションを追加
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {actions.map((action, index) => {
              const descriptor = actionDescriptor(action.capability);
              return (
                <div
                  key={`action-${index}`}
                  className="rounded-lg border border-neutral-200 bg-white p-3"
                >
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1 text-[11px] text-neutral-600">
                      アクション
                      <select
                        value={action.capability}
                        onChange={(event) => setAction(index, event.target.value)}
                        className={inputClass}
                      >
                        {descriptors.actions.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      aria-label="アクションを削除"
                      onClick={() =>
                        setActions((current) =>
                          current.filter((_, entryIndex) => entryIndex !== index),
                        )
                      }
                      className="mb-0.5 flex h-8 w-8 items-center justify-center rounded text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      ×
                    </button>
                  </div>
                  {descriptor && descriptor.params.length > 0 && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {descriptor.params.map((param) => (
                        <ParamField
                          key={param.name}
                          param={param}
                          value={action.params[param.name]}
                          onChange={(value) =>
                            setActions((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, params: { ...entry.params, [param.name]: value } }
                                  : entry,
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                  {descriptor?.description && (
                    <p className="mt-1 text-[10px] text-neutral-400">{descriptor.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        )}

        {error !== "" && <p className="mt-4 text-[12px] text-rose-600">{error}</p>}

        <div className="mt-5 rounded-md bg-neutral-50 px-3 py-2 text-[10px] text-neutral-500">
          変数: <code>{"{{task.name}}"}</code>, <code>{"{{task.due_on}}"}</code>,{" "}
          <code>{"{{project.name}}"}</code> などがアクション内で使えます。
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-100 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] text-neutral-700 hover:bg-neutral-50"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="h-8 rounded-md bg-[#2c60b8] px-4 text-[12px] font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
        >
          {busy ? "保存中…" : rule ? "変更を保存" : "ルールを作成"}
        </button>
      </div>
    </Dialog>
  );
}
