import type { RuleAction, RuleCondition, ConditionOperator } from "./types";
import type { ConditionFieldDescriptor, RuleDescriptors } from "./descriptors";
import { conditionFieldType, conditionOperatorsForType, customConditionType, RULE_TEMPLATE_FIELDS, type ConditionType } from "./condition-schema";

export const RULE_OPTION_KINDS = ["user", "section", "project", "task", "reference"] as const;
export type RuleOptionKind = typeof RULE_OPTION_KINDS[number];
export type RuleEditorOption = { value: number; label: string; description?: string };
export type RuleOptionQuery = { kind: RuleOptionKind; query: string; ids: number[]; fieldId?: number };

export function parseRuleOptionQuery(params: URLSearchParams):
  { ok: true; value: RuleOptionQuery } | { ok: false; error: string } {
  const kind = params.get("kind");
  if (!RULE_OPTION_KINDS.some((entry) => entry === kind)) return { ok: false, error: "invalid option kind" };
  const rawIds = params.get("ids");
  const idParts = rawIds === null ? [] : rawIds.split(",");
  const ids = idParts.map(Number);
  if (ids.length > 50 || idParts.some((id) => !/^[1-9]\d*$/.test(id)) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return { ok: false, error: "ids must contain at most 50 positive integers" };
  }
  const rawFieldId = params.get("field_id");
  const fieldId = rawFieldId === null ? undefined : Number(rawFieldId);
  if (fieldId !== undefined && (!/^[1-9]\d*$/.test(rawFieldId ?? "") || !Number.isSafeInteger(fieldId) || fieldId <= 0)) {
    return { ok: false, error: "invalid field_id" };
  }
  if (kind === "reference" && fieldId === undefined) return { ok: false, error: "field_id is required" };
  return { ok: true, value: { kind: kind as RuleOptionKind, query: (params.get("q") ?? "").trim().slice(0, 100), ids: [...new Set(ids)], fieldId } };
}

/** Preserve redacted webhook references and untouched params during ordinary edits. */
export function updateRuleActionParam(action: RuleAction, name: string, value: unknown): RuleAction {
  const params = { ...action.params, [name]: value };
  if (action.capability === "task.set_custom_field" && name === "field_id" && String(action.params.field_id) !== String(value)) delete params.value;
  return { ...action, params };
}

export function changeRuleActionCapability(action: RuleAction, capability: string): RuleAction {
  return action.capability === capability ? action : { capability, params: {} };
}

/** The v1 API also permits a scalar for `in`, and comma text for multi-select actions. */
export function ruleCollectionValues(value: unknown, { scalar = false, commaSeparated = false } = {}): unknown[] {
  if (Array.isArray(value)) return value;
  if (commaSeparated && typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return scalar && value !== null && value !== undefined && value !== "" ? [value] : [];
}

const labels: Record<string, string> = {
  "task.id": "タスク", "task.project_id": "主プロジェクト", "task.section_id": "セクション", "task.parent_task_id": "親タスク",
  "task.name": "タスク名", "task.description": "タスクの説明", "task.assignee_id": "担当者", "task.created_by": "タスクを作成したメンバー",
  "task.completed": "完了状態", "task.is_milestone": "マイルストーン", "task.start_on": "開始日", "task.due_on": "期日",
  "task.progress": "進捗", "task.status": "タスクのステータス", "task.position": "タスクの並び順",
  "task.created_at": "タスクの作成日時", "task.updated_at": "タスクの更新日時",
  "project.id": "プロジェクト", "project.name": "プロジェクト名", "project.status": "プロジェクトステータス",
  "project.status_color": "プロジェクトステータスの色", "project.owner_id": "プロジェクトのオーナー", "project.due_on": "プロジェクトの期日",
  "event.id": "イベント番号", "event.workspace_id": "ワークスペース", "event.project_id": "操作したプロジェクト",
  "event.actor_id": "操作したメンバー", "event.type": "操作の種類", "event.version": "イベントのバージョン",
  "event.subject_type": "操作対象の種類", "event.subject_id": "操作対象", "event.correlation_id": "関連する操作",
  "event.causation_id": "直前の操作", "event.chain_depth": "連鎖の段数", "event.occurred_at": "操作した日時",
  "event.attempts": "試行回数", "event.data": "受信データ",
};

export function ruleInputFields(descriptors: RuleDescriptors): ConditionFieldDescriptor[] {
  const fields = new Map(descriptors.conditionFields.map((field) => [field.id, field]));
  for (const field of RULE_TEMPLATE_FIELDS) {
    if (fields.has(field.path)) continue;
    fields.set(field.path, {
      id: field.path, label: labels[field.path] ?? field.label,
      type: field.type === "date" || field.type === "number" || field.type === "boolean" ? field.type : "text",
      valueType: field.type,
      group: field.path.startsWith("task.") ? "タスク" : field.path.startsWith("project.") ? "プロジェクト" : "イベント",
    });
  }
  return [...fields.values()];
}

export function ruleConditionType(field: string, descriptors: RuleDescriptors): ConditionType {
  const meta = descriptors.conditionFields.find((entry) => entry.id === field);
  if (meta?.valueType) return meta.valueType;
  if (field.startsWith("custom.")) {
    const custom = descriptors.customFields.find((entry) => String(entry.id) === field.slice(7) || entry.name === field.slice(7));
    if (custom) return customConditionType(custom.field_type);
  }
  return conditionFieldType(field) ?? "text";
}

export function ruleConditionOperators(field: string, descriptors: RuleDescriptors) {
  const supported = conditionOperatorsForType(ruleConditionType(field, descriptors));
  return descriptors.operators.filter((operator) => supported.includes(operator.value));
}

export function conditionUsesArray(condition: RuleCondition, descriptors: RuleDescriptors): boolean {
  const type = ruleConditionType(condition.field, descriptors);
  return condition.op === "in" || condition.op === "not_in" ||
    ((type === "text_collection" || type === "id_collection") && condition.op !== "contains" && condition.op !== "not_contains");
}

export function changeRuleCondition(condition: RuleCondition, field: string, op: ConditionOperator, descriptors: RuleDescriptors): RuleCondition {
  const supported = ruleConditionOperators(field, descriptors);
  const operator = supported.some((entry) => entry.value === op) ? op : supported[0]?.value ?? "eq";
  if (condition.field === field && condition.op === operator) return condition;
  const next: RuleCondition = { field, op: operator };
  if (operator === "is_empty" || operator === "is_not_empty") return next;
  next.value = conditionUsesArray(next, descriptors) ? [] : ruleConditionType(field, descriptors) === "boolean" ? true : "";
  return next;
}

export type RuleVariable = { path: string; label: string; group: string; type: ConditionType };
export type RuleVariableTarget = "text" | "number" | "date" | "id_collection" | "text_collection";

export function ruleVariables(descriptors: RuleDescriptors): RuleVariable[] {
  return ruleInputFields(descriptors).filter((field) => !field.id.startsWith("custom.") || /^custom\.[1-9]\d*$/.test(field.id))
    .map((field) => ({ path: field.id, label: field.label, group: field.group, type: ruleConditionType(field.id, descriptors) }));
}

export function compatibleRuleVariables(variables: RuleVariable[], type: RuleVariableTarget): RuleVariable[] {
  if (type === "text" || type === "text_collection") return variables;
  return variables.filter((variable) => type === "number"
    ? variable.type === "number" || variable.type === "id"
    : type === "date" ? variable.type === "date" : variable.type === "id");
}

/** Typed values stay typed; a variable occupies the whole numeric/date value or one ID-array entry. */
export function insertRuleVariable(value: unknown, variable: RuleVariable, type: RuleVariableTarget, start?: number, end?: number): unknown {
  const token = `{{${variable.path}}}`;
  if (type === "id_collection" || type === "text_collection") return [...(Array.isArray(value) ? value : []), token];
  if (type !== "text") return token;
  const text = typeof value === "string" ? value : "";
  const from = Math.max(0, Math.min(text.length, start ?? text.length));
  const to = Math.max(from, Math.min(text.length, end ?? from));
  return text.slice(0, from) + token + text.slice(to);
}
