"use client";

import type { RuleDescriptors } from "@/lib/automation/descriptors";
import type { RuleAction, RuleTrigger } from "@/lib/automation/types";
import { changeRuleActionCapability, ruleVariables, updateRuleActionParam } from "@/lib/automation/no-code-inputs";
import { configuredTaskId, hasTaskSubject } from "@/lib/automation/task-target";
import RuleEntityPicker from "./RuleEntityPicker";
import RuleMultiEntityPicker from "./RuleMultiEntityPicker";
import RuleCollectionField from "./RuleCollectionField";
import RuleValueField from "./RuleValueField";
import { fieldHintClass, fieldLabelClass, SelectControl } from "../ui/form-controls";

export type RuleActionFieldsProps = {
  action: RuleAction;
  descriptors: RuleDescriptors;
  projectId: number;
  onChange: (action: RuleAction) => void;
  triggers?: RuleTrigger[];
};

export function RuleActionFields({ action, descriptors, projectId, onChange, triggers }: RuleActionFieldsProps) {
  const descriptor = descriptors.actions.find((entry) => entry.id === action.capability);
  const variables = ruleVariables(descriptors);
  const needsFixedTask = descriptor?.requiresTask && triggers?.some((trigger) => !hasTaskSubject(trigger.event));
  const field = descriptors.customFields.find((entry) => String(entry.id) === String(action.params.field_id));
  function change(name: string, value: unknown) { onChange(updateRuleActionParam(action, name, value)); }
  function customValue() {
    if (!field) return <p className="text-[12px] text-muted">編集するフィールドを選択してください。保存済みの値は保持されます。</p>;
    const value = action.params.value;
    const update = (next: unknown) => change("value", next);
    let editor;
    if (field.field_type === "people" || field.field_type === "reference") {
      editor = <RuleMultiEntityPicker projectId={projectId} kind={field.field_type === "people" ? "user" : "reference"}
        fieldId={field.field_type === "reference" ? field.id : undefined} value={value} onChange={update} label="値" variables={variables} />;
    } else if (field.field_type === "multi_select") {
      editor = <RuleCollectionField label="値" value={value} onChange={update} commaSeparated
        options={field.options.map((option) => ({ value: option, label: option }))} variables={variables} />;
    } else {
      editor = <RuleValueField label="値" value={value} onChange={update} variables={variables}
        type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
        options={field.field_type === "select" ? field.options.map((option) => ({ value: option, label: option })) : undefined} />;
    }
    return <div className="space-y-1">{editor}<button type="button" onClick={() => update(null)}
      className="text-[12px] text-muted hover:text-text">値をクリア</button>
      {value === null && <p className={`${fieldHintClass}`}>実行すると値をクリアします。</p>}</div>;
  }
  return (
    <div className="space-y-4" data-rule-action-fields>
      <label className={fieldLabelClass}>アクション
        <SelectControl containerClassName="mt-1" value={action.capability}
          onChange={(event) => onChange(changeRuleActionCapability(action, event.target.value))}>
          {!descriptor && <option value={action.capability}>{action.capability ? "保存済みのアクション" : "アクションを選択"}</option>}
          {descriptors.actions.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </SelectControl>
      </label>
      {descriptor?.description && <p className="text-[12px] leading-relaxed text-muted">{descriptor.description}</p>}
      {needsFixedTask && <div className="space-y-1">
        <RuleEntityPicker projectId={projectId} kind="task" value={configuredTaskId(action.params.task_id)} label="対象タスク" required
          onChange={(id) => change("task_id", id ?? undefined)} />
        <p className={fieldHintClass}>タスクを持つトリガーでは、そのタスクに対して実行します。</p>
      </div>}
      {descriptor?.params.map((param) => {
        const value = action.params[param.name];
        if (action.capability === "task.set_custom_field" && param.name === "value") {
          return <div key={`${param.name}/${field?.id ?? "none"}`}>{customValue()}</div>;
        }
        const entity = param.name === "user_id" || param.name === "assignee_id" ? "user"
          : param.name === "section_id" ? "section" : param.name === "project_id" ? "project" : undefined;
        if (entity) return <RuleEntityPicker key={param.name} projectId={projectId} kind={entity} value={configuredTaskId(value)}
          label={param.label} required={param.required} onChange={(id) => change(param.name, id ?? undefined)} />;
        if (param.type === "password") return <div key={param.name} className="space-y-1">
          <RuleValueField label={param.label} value={value} onChange={(next) => change(param.name, next)} type="password"
            placeholder={action.webhookActionId && value === undefined ? "保存済みの署名キーを使用" : param.placeholder} />
          {action.webhookActionId && <p className={fieldHintClass}>入力しなければ、同じURLの署名キーを保持します。</p>}
          <div className="flex flex-wrap gap-3 text-[12px]">
            <button type="button" onClick={() => change(param.name, "")} className="text-muted hover:text-text">署名キーを削除</button>
            {value !== undefined && action.webhookActionId && <button type="button" onClick={() => change(param.name, undefined)}
              className="text-accent-text">保存済みのキーを使う</button>}
          </div>
          {value === "" && <p className="text-[12px] text-warning">保存すると署名キーを削除します。</p>}
        </div>;
        return <RuleValueField key={param.name} label={param.label} value={value} onChange={(next) => change(param.name, next)}
          type={param.type === "number" || param.type === "date" || param.type === "boolean" ? param.type : "text"}
          multiline={param.type === "textarea"} options={param.type === "select" ? param.options : undefined}
          variables={param.name === "field_id" ? undefined : variables} placeholder={param.placeholder} help={param.help} />;
      })}
      {!descriptor && <p role="status" className="text-[12px] text-muted">このアクションの設定は保持されています。種類を選び直すと設定を置き換えます。</p>}
    </div>
  );
}

export default RuleActionFields;
