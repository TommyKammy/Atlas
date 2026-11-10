import type { RuleCondition } from "./types";

export type ConditionType = "text" | "number" | "id" | "boolean" | "date" | "datetime" | "text_collection" | "id_collection" | "json";

// Include the older API-only fields still present in the explicit rule snapshot.
const fields: Record<string, ConditionType> = {
  "task.id": "id", "task.project_id": "id", "task.section_id": "id", "task.parent_task_id": "id",
  "task.name": "text", "task.description": "text", "task.assignee_id": "id", "task.created_by": "id",
  "task.completed": "boolean", "task.is_milestone": "boolean", "task.start_on": "date", "task.due_on": "date",
  "task.progress": "number", "task.status": "text", "task.position": "number",
  "task.created_at": "datetime", "task.updated_at": "datetime",
  "project.id": "id", "project.name": "text", "project.status": "text", "project.status_color": "text",
  "project.owner_id": "id", "project.due_on": "date",
  "event.id": "id", "event.workspace_id": "id", "event.project_id": "id", "event.actor_id": "id",
  "event.type": "text", "event.version": "number", "event.subject_type": "text", "event.subject_id": "id",
  "event.correlation_id": "text", "event.causation_id": "id", "event.chain_depth": "number",
  "event.occurred_at": "datetime", "event.attempts": "number", "event.data": "json",
};

export const RULE_TEMPLATE_FIELDS = Object.entries(fields).map(([path, type]) => ({ path, label: path, type }));

export function conditionOperatorsForType(type: ConditionType): RuleCondition["op"][] {
  const common: RuleCondition["op"][] = ["eq", "neq", "in", "not_in", "is_empty", "is_not_empty"];
  if (["text", "text_collection", "id_collection", "json"].includes(type)) common.push("contains", "not_contains");
  if (["number", "id", "date", "datetime", "json"].includes(type)) common.push("gt", "gte", "lt", "lte");
  return common;
}

export function conditionFieldType(field: string): ConditionType | null {
  if (Object.hasOwn(fields, field)) return fields[field];
  if ((field.startsWith("custom.") && field.length > 7) || /^event\.data\.[^.\s]+(?:\.[^.\s]+)*$/.test(field)) return "json";
  return null;
}

export function customConditionType(fieldType: string): ConditionType {
  if (fieldType === "number" || fieldType === "timer" || fieldType === "time_tracking") return "number";
  if (fieldType === "date" || fieldType === "completed_on") return "date";
  if (fieldType === "created_at" || fieldType === "modified_at") return "datetime";
  if (fieldType === "multi_select") return "text_collection";
  if (["people", "reference", "collaborators", "blocked_by", "blocking"].includes(fieldType)) return "id_collection";
  if (["text", "select", "auto_id"].includes(fieldType)) return "text";
  // Formula, rollup and lookup results may have different configured result types.
  return "json";
}

function dateValue(value: unknown): boolean {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function scalar(value: unknown, type: ConditionType): boolean {
  if (type === "text") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean" || value === "true" || value === "false";
  if (type === "date") return dateValue(value);
  if (type === "datetime") return dateValue(value) || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]/.test(value) && dateValue(value.slice(0, 10)) && Number.isFinite(Date.parse(value)));
  if (type === "id") return (typeof value === "number" || (typeof value === "string" && /^[1-9]\d*$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  if (type === "number") return (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value));
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean";
}

function missingComparisonValue(value: unknown): boolean {
  const pending = [value];
  while (pending.length) {
    const entry = pending.pop();
    if (entry === undefined || entry === null || (typeof entry === "string" && entry.trim() === "")) return true;
    if (Array.isArray(entry)) {
      if (entry.length === 0) return true;
      for (const item of entry) pending.push(item);
    }
  }
  return false;
}

/** A value is optional only when the operator explicitly tests for emptiness. */
export function conditionInputProblem(condition: RuleCondition, type = typeof condition.field === "string" ? conditionFieldType(condition.field) : null): string | null {
  if (typeof condition.field !== "string" || !conditionFieldType(condition.field) || !type) return "条件の項目を選択してください。";
  if (!conditionOperatorsForType(type).includes(condition.op)) return "この項目で使える比較方法を選んでください。";
  if (condition.op === "is_empty" || condition.op === "is_not_empty") return null;
  if (missingComparisonValue(condition.value)) {
    return "比較する値を入力してください。空かどうかを判定する場合は「空である」または「空でない」を選んでください。";
  }
  return validConditionValue(condition, type) ? null : "比較する値の形式を確認してください。";
}

export function validConditionValue(condition: RuleCondition, type = conditionFieldType(condition.field)): boolean {
  if (!type) return false;
  if (condition.op === "is_empty" || condition.op === "is_not_empty") return true;
  const value = condition.value;
  if (missingComparisonValue(value)) return false;
  if (condition.op === "gt" || condition.op === "gte" || condition.op === "lt" || condition.op === "lte") {
    return ["number", "id", "date", "datetime", "json"].includes(type) && scalar(value, type);
  }
  if (condition.op === "contains" || condition.op === "not_contains") {
    return ["text", "text_collection", "id_collection", "json"].includes(type) &&
      scalar(value, type === "text" || type === "text_collection" ? "text" : type === "id_collection" ? "id" : "json");
  }
  if (condition.op === "in" || condition.op === "not_in") {
    return (Array.isArray(value) ? value : [value]).every((entry) => scalar(entry,
      type === "text_collection" ? "text" : type === "id_collection" ? "id" : type));
  }
  if (type === "text_collection" || type === "id_collection") return Array.isArray(value) &&
    value.every((entry) => scalar(entry, type === "text_collection" ? "text" : "id"));
  if (type === "json" && value !== undefined) return true;
  return scalar(value, type);
}
