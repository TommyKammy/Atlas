import {
  customFieldDisplay,
  formatCustomFieldInputValue,
  isCustomFieldType,
  normalizeCustomFieldConfig,
  type CustomField,
  type CustomFieldConfig,
  type CustomFieldTaskMeta,
  type CustomFieldType,
  type CustomValue,
} from "./custom-fields";

export type CustomFieldConflict = {
  fieldId: number;
  name: string;
  fieldType: CustomFieldType;
  config: CustomFieldConfig;
  /** Server value at the time of the 409. */
  current: CustomValue | null;
  /** Value the editor tried to save. */
  attempted: unknown;
};

export type TaskConflictComparisonRow = {
  key: string;
  label: string;
  attempted: string;
  current: string;
};

function parseCustomValue(raw: unknown): CustomValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const number = value.value_number === null || value.value_number === undefined
    ? null
    : Number(value.value_number);
  return {
    value_text: typeof value.value_text === "string" ? value.value_text : null,
    value_number: number !== null && Number.isFinite(number) ? number : null,
    value_date: typeof value.value_date === "string" ? value.value_date : null,
    value_json: value.value_json ?? null,
  };
}

/** Parse the custom_field section of a /api/task-values 409 response. */
export function parseCustomFieldConflict(
  raw: unknown,
  attempted: unknown,
): CustomFieldConflict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  const fieldId = Number(payload.field_id);
  if (!Number.isInteger(fieldId) || fieldId <= 0) return null;
  if (typeof payload.name !== "string" || payload.name === "") return null;
  if (!isCustomFieldType(payload.field_type)) return null;
  return {
    fieldId,
    name: payload.name,
    fieldType: payload.field_type,
    config: normalizeCustomFieldConfig(payload.config),
    current: parseCustomValue(payload.value),
    attempted,
  };
}

/**
 * Rows shown in the conflict panel. Unknown attempted keys are ignored, and a
 * custom-field conflict is appended after task fields.
 */
export function taskConflictComparisonRows({
  attempted,
  current,
  customField,
  labels,
  describeValue,
  users,
  task,
  customValues,
  customFields,
}: {
  attempted: Record<string, unknown>;
  current: Record<string, unknown>;
  customField?: CustomFieldConflict | null;
  labels: Record<string, string>;
  describeValue: (key: string, value: unknown) => string;
  users: { id: number; name: string }[];
  task?: CustomFieldTaskMeta;
  customValues?: Record<number, CustomValue>;
  customFields?: CustomField[];
}): TaskConflictComparisonRow[] {
  const rows: TaskConflictComparisonRow[] = [];
  for (const key of Object.keys(attempted)) {
    if (!(key in labels)) continue;
    rows.push({
      key,
      label: labels[key],
      attempted: describeValue(key, attempted[key]),
      current: key === "assignee_id"
        ? String(current.assignee_name ?? "–")
        : describeValue(key, current[key]),
    });
  }
  if (customField) {
    const field: CustomField = {
      id: customField.fieldId,
      name: customField.name,
      field_type: customField.fieldType,
      options: [],
      config: customField.config,
    };
    rows.push({
      key: `cf-${customField.fieldId}`,
      label: customField.name,
      attempted: formatCustomFieldInputValue(field, customField.attempted, users),
      current: customField.current
        ? customFieldDisplay(field, customField.current, task, users, customValues, customFields)
        : "–",
    });
  }
  return rows;
}
