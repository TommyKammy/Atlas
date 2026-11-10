import type { Queryable } from "./db";
import { isCustomFieldType, isReadOnlyFieldType, type CustomValue } from "./custom-fields";

type ValueField = { field_type: string; config?: { source_project_ids?: unknown } | null };
type ValueResult =
  | { ok: true; value: CustomValue }
  | { ok: false; error: string; status: 400 | 403 };

function positiveIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((entry) => (typeof entry !== "number" && typeof entry !== "string") ||
    !Number.isSafeInteger(Number(entry)) || Number(entry) <= 0)) return null;
  return [...new Set(value.map(Number))];
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Shared typed-column and reference semantics for task editing and automation. */
export async function normalizeTaskCustomValue(
  field: ValueField,
  input: unknown,
  userId: number,
  q: Queryable,
): Promise<ValueResult> {
  const type = field.field_type;
  const invalid = (error: string, status: 400 | 403 = 400): ValueResult => ({ ok: false, error, status });
  if (!isCustomFieldType(type) || isReadOnlyFieldType(type)) return invalid("this field is read-only");
  if (type === "timer") return invalid("use the timer endpoint");
  const value: CustomValue = { value_text: null, value_number: null, value_date: null, value_json: null };
  if (input === null || (input === "" && type !== "people" && type !== "reference")) return { ok: true, value };

  if (type === "number") {
    if ((typeof input !== "number" && typeof input !== "string") ||
      (typeof input === "string" && input.trim() === "") || !Number.isFinite(Number(input))) {
      return invalid("numeric value required");
    }
    value.value_number = Number(input);
  } else if (type === "date") {
    if (typeof input !== "string" || !validDate(input)) return invalid("invalid date");
    value.value_date = input;
    value.value_text = input;
  } else if (type === "people" || type === "reference") {
    const ids = positiveIds(input);
    if (ids === null) return invalid(type === "people" ? "member IDs must be an array of positive integers" : "reference IDs must be an array of positive integers");
    if (ids.length === 0) return { ok: true, value };
    let rows: { id: number; name: string }[];
    if (type === "people") {
      const users = await q.query(
        "SELECT id, name FROM users WHERE id = ANY($1::bigint[]) AND deactivated_at IS NULL",
        [ids],
      );
      if (users.rowCount !== ids.length) return invalid("invalid member");
      rows = users.rows;
    } else {
      const sources = positiveIds(field.config?.source_project_ids);
      if (!sources?.length) return invalid("reference source projects are required");
      const access = await q.query(
        `SELECT p.id FROM projects p
         WHERE p.id = ANY($1::bigint[]) AND p.deleted_at IS NULL
           AND (EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin AND u.deactivated_at IS NULL)
             OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2))`,
        [sources, userId],
      );
      if (access.rowCount !== sources.length) return invalid("source project access denied", 403);
      const tasks = await q.query(
        `SELECT t.id, t.name FROM tasks t
         WHERE t.id = ANY($1::bigint[]) AND t.deleted_at IS NULL
           AND (t.project_id = ANY($2::bigint[]) OR EXISTS (
             SELECT 1 FROM task_project_memberships m
             WHERE m.task_id = t.id AND m.project_id = ANY($2::bigint[])
           ))`,
        [ids, sources],
      );
      if (tasks.rowCount !== ids.length) return invalid("invalid reference");
      rows = tasks.rows;
    }
    const names = new Map(rows.map((row) => [Number(row.id), String(row.name)]));
    value.value_json = ids;
    value.value_text = ids.map((id) => names.get(id)).join(", ");
  } else if (type === "multi_select") {
    if ((Array.isArray(input) && input.some((entry) => typeof entry !== "string")) ||
      (!Array.isArray(input) && typeof input !== "string")) return invalid("selection must contain strings");
    const selected = (Array.isArray(input) ? input : input.split(","))
      .map((entry) => entry.trim()).filter(Boolean);
    if (selected.length > 0) {
      value.value_json = selected;
      value.value_text = selected.join(", ");
    }
  } else {
    if (typeof input !== "string") return invalid("text value required");
    value.value_text = input;
  }
  return { ok: true, value };
}

export function isEmptyTaskCustomValue(value: CustomValue): boolean {
  return value.value_text === null && value.value_number === null && value.value_date == null &&
    (value.value_json == null || (Array.isArray(value.value_json) && value.value_json.length === 0));
}

export function equalTaskCustomValue(previous: CustomValue | undefined, value: CustomValue): boolean {
  if (!previous) return isEmptyTaskCustomValue(value);
  return previous.value_text === value.value_text &&
    (previous.value_number === null ? null : Number(previous.value_number)) === value.value_number &&
    (previous.value_date ?? null) === (value.value_date ?? null) &&
    JSON.stringify(previous.value_json ?? null) === JSON.stringify(value.value_json ?? null);
}
