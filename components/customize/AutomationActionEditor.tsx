"use client";

import type { DescriptorOption, DescriptorParam, RuleDescriptors } from "@/lib/automation/descriptors";
import { configuredTaskId } from "@/lib/automation/task-target";
import type { RuleAction } from "@/lib/automation/types";
import AutomationCustomFieldValue from "./AutomationCustomFieldValue";

const inputClass =
  "mt-1 h-8 w-full rounded-md border border-line bg-white px-2 text-[12px] outline-none focus:border-accent";
const areaClass =
  "mt-1 min-h-[68px] w-full rounded-md border border-line bg-white px-2 py-1.5 text-[12px] outline-none focus:border-accent";

function actionWithParam(action: RuleAction, name: string, value: unknown): RuleAction {
  const params = { ...action.params, [name]: value };
  if (action.capability === "task.set_custom_field" && name === "field_id") params.value = undefined;
  return { ...action, params };
}

function ActionParamField({ action, descriptors, param, value, onChange }: {
  action: RuleAction;
  descriptors: RuleDescriptors;
  param: DescriptorParam;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (action.capability === "task.set_custom_field" && param.name === "value") {
    const field = descriptors.customFields.find((entry) => entry.id === Number(action.params.field_id));
    return (
      <div>
        <AutomationCustomFieldValue key={field?.id ?? "none"} field={field} value={value} onChange={onChange}
          users={descriptors.conditionFields.find((entry) => entry.id === "task.assignee_id")?.options ?? []} />
        {field && <button type="button" className="mt-1 text-[11px] text-muted hover:text-text"
          onClick={() => onChange(null)}>値をクリア</button>}
        {value === null && <p className="mt-1 text-[11px] text-muted">実行すると値をクリアします。</p>}
      </div>
    );
  }
  return <ParamField param={param} value={value} onChange={onChange} />;
}

export function defaultParams(paramDefs: DescriptorParam[]): Record<string, unknown> {
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
    <span className="block text-[11px] font-medium text-secondary">
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
        {param.help && <span className="mt-0.5 block text-[10px] text-subtle">{param.help}</span>}
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
        type={param.type === "number" || param.type === "date" || param.type === "password" ? param.type : "text"}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        placeholder={param.placeholder}
        className={inputClass}
      />
      {param.help && <span className="mt-0.5 block text-[10px] text-subtle">{param.help}</span>}
    </label>
  );
}

export default function AutomationActionEditor({ action, descriptors, taskTriggersOnly, compact = false, onUpdate, onRemove }: {
  action: RuleAction;
  descriptors: RuleDescriptors;
  taskTriggersOnly: boolean;
  compact?: boolean;
  onUpdate: (update: (current: RuleAction) => RuleAction) => void;
  onRemove: () => void;
}) {
  const descriptor = descriptors.actions.find((entry) => entry.id === action.capability);
  const select = (
    <select value={action.capability} className={inputClass}
      onChange={(event) => {
        const capability = event.target.value;
        const next = descriptors.actions.find((entry) => entry.id === capability);
        onUpdate(() => ({ capability, params: next ? defaultParams(next.params) : {} }));
      }}>
      {descriptors.actions.map((entry) => {
        const taskId = entry.id === action.capability ? action.params.task_id : undefined;
        const disabled = entry.requiresTask && !taskTriggersOnly && configuredTaskId(taskId) === null;
        return <option key={entry.id} value={entry.id} disabled={disabled}>
          {entry.label}{disabled ? "（タスクが必要）" : ""}
        </option>;
      })}
    </select>
  );
  return (
    <div className={compact ? "rounded border border-line-subtle bg-surface-subtle p-2" : "rounded-lg border border-line bg-surface p-3"}>
      <div className="flex items-end gap-2">
        {compact ? select : <label className="min-w-0 flex-1 text-[11px] text-secondary">アクション{select}</label>}
        <button type="button" aria-label="アクションを削除" onClick={onRemove}
          className={`mb-0.5 flex h-8 w-8 ${compact ? "shrink-0 " : ""}items-center justify-center rounded text-subtle hover:bg-danger-soft hover:text-danger`}>×</button>
      </div>
      {descriptor && descriptor.params.length > 0 && (
        <div className={compact ? "mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2" : "mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"}>
          {descriptor.params.map((param) => (
            <ActionParamField key={param.name} action={action} descriptors={descriptors} param={param}
              value={action.params[param.name]} onChange={(value) => onUpdate((current) => actionWithParam(current, param.name, value))} />
          ))}
        </div>
      )}
      {!compact && descriptor?.description && <p className="mt-1 text-[10px] text-subtle">{descriptor.description}</p>}
    </div>
  );
}
