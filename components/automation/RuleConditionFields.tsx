"use client";

import { useId } from "react";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import type { RuleCondition } from "@/lib/automation/types";
import { changeRuleCondition, conditionUsesArray, ruleConditionOperators, ruleConditionType, ruleInputFields } from "@/lib/automation/no-code-inputs";
import { configuredTaskId } from "@/lib/automation/task-target";
import { conditionInputProblem } from "@/lib/automation/condition-schema";
import RuleEntityPicker from "./RuleEntityPicker";
import RuleMultiEntityPicker from "./RuleMultiEntityPicker";
import RuleCollectionField from "./RuleCollectionField";
import RuleValueField, { ruleInputClass } from "./RuleValueField";

export type RuleConditionFieldsProps = {
  conditions: RuleCondition[];
  descriptors: RuleDescriptors;
  projectId: number;
  onChange: (conditions: RuleCondition[]) => void;
};

export function RuleConditionFields({ conditions, descriptors, projectId, onChange }: RuleConditionFieldsProps) {
  const errorPrefix = useId();
  const fields = ruleInputFields(descriptors);
  const groups = [...new Set(fields.map((field) => field.group))];
  function update(index: number, value: RuleCondition) { onChange(conditions.map((condition, item) => item === index ? value : condition)); }
  function valueEditor(condition: RuleCondition, index: number, problem: string | null) {
    if (condition.op === "is_empty" || condition.op === "is_not_empty") return null;
    const type = ruleConditionType(condition.field, descriptors);
    const validation = { invalid: Boolean(problem), describedBy: problem ? `${errorPrefix}-${index}-error` : undefined };
    const meta = fields.find((field) => field.id === condition.field);
    const custom = condition.field.startsWith("custom.") ? descriptors.customFields.find((field) =>
      String(field.id) === condition.field.slice(7) || field.name === condition.field.slice(7)) : undefined;
    const entity = ["task.id", "task.parent_task_id"].includes(condition.field) ? "task"
      : ["task.assignee_id", "task.created_by", "project.owner_id", "event.actor_id"].includes(condition.field) ? "user"
        : ["task.project_id", "project.id", "event.project_id"].includes(condition.field) ? "project"
          : condition.field === "task.section_id" ? "section"
            : type === "id_collection" ? custom?.field_type === "people" ? "user" : custom?.field_type === "reference" ? "reference" : "task" : undefined;
    const change = (value: unknown) => update(index, { ...condition, value });
    if (entity) {
      return conditionUsesArray(condition, descriptors)
        ? <RuleMultiEntityPicker {...validation} projectId={projectId} kind={entity} fieldId={entity === "reference" ? custom?.id : undefined}
          value={condition.value} onChange={change} label="比較する値" allowScalar={condition.op === "in" || condition.op === "not_in"} />
        : <RuleEntityPicker {...validation} projectId={projectId} kind={entity} fieldId={entity === "reference" ? custom?.id : undefined}
          value={configuredTaskId(condition.value)} onChange={(value) => change(value ?? "")} label="比較する値" />;
    }
    const valueType = type === "number" || type === "id" ? "number" : type === "date" || type === "datetime" || type === "boolean" ? type : "text";
    const options = meta?.options ?? ((custom?.field_type === "select" || custom?.field_type === "multi_select")
      ? custom.options.map((option) => ({ value: option, label: option })) : undefined);
    return conditionUsesArray(condition, descriptors)
      ? <RuleCollectionField {...validation} key={`${condition.field}/${condition.op}/${JSON.stringify(condition.value)}`} label="比較する値"
        value={condition.value} onChange={change} type={valueType} options={options} />
      : <RuleValueField {...validation} label="比較する値" value={condition.value} onChange={change} type={valueType} options={options} />;
  }
  return (
    <div className="space-y-3" data-rule-condition-fields>
      <p className="text-[12px] leading-relaxed text-muted">すべての条件を満たしたときに進みます。条件がない場合は、毎回この先へ進みます。</p>
      {conditions.map((condition, index) => {
        const problem = conditionInputProblem(condition, ruleConditionType(condition.field, descriptors));
        return <div key={index} data-rule-condition-index={index} className={`space-y-3 rounded-lg border bg-surface p-3 ${problem ? "border-rose-300" : "border-line"}`}>
        <div className="flex items-start gap-2">
          <label className="min-w-0 flex-1 text-[12px] font-medium text-secondary">条件の項目
            <select value={condition.field} className={`${ruleInputClass} mt-1`}
              onChange={(event) => update(index, changeRuleCondition(condition, event.target.value, condition.op, descriptors))}>
              {!fields.some((field) => field.id === condition.field) && <option value={condition.field}>保存済みの項目</option>}
              {groups.map((group) => <optgroup key={group} label={group}>{fields.filter((field) => field.group === group).map((field) =>
                <option key={field.id} value={field.id}>{field.label}</option>)}</optgroup>)}
            </select>
          </label>
          <button type="button" aria-label={`条件${index + 1}を削除`} onClick={() => onChange(conditions.filter((_, item) => item !== index))}
            className="mt-6 rounded px-2 py-1 text-subtle hover:bg-danger-soft hover:text-danger">×</button>
        </div>
        <label className="block text-[12px] font-medium text-secondary">比較方法
          <select value={condition.op} className={`${ruleInputClass} mt-1`}
            onChange={(event) => update(index, changeRuleCondition(condition, condition.field, event.target.value as RuleCondition["op"], descriptors))}>
            {ruleConditionOperators(condition.field, descriptors).map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
          </select>
        </label>
        <div data-rule-condition-value>{valueEditor(condition, index, problem)}</div>
        {problem && <p id={`${errorPrefix}-${index}-error`} data-rule-condition-error className="text-[12px] leading-5 text-danger"><span aria-hidden="true" className="mr-1 font-semibold">!</span>{problem}</p>}
      </div>; })}
      <button type="button" disabled={conditions.length >= descriptors.limits.conditionsPerPath} onClick={() => {
        const field = fields[0]?.id ?? "task.name";
        onChange([...conditions, changeRuleCondition({ field: "", op: "eq" }, field, "eq", descriptors)]);
      }} className="rounded-md border border-line-strong px-3 py-2 text-[12px] font-medium hover:bg-hover disabled:opacity-40">条件を追加</button>
    </div>
  );
}

export default RuleConditionFields;
