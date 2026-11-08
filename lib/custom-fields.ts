export type BuiltinFieldType =
  | "people"
  | "auto_id"
  | "project"
  | "completed_on"
  | "created_at"
  | "modified_at"
  | "created_by"
  | "collaborators"
  | "attachments"
  | "blocked_by"
  | "blocking"
  | "formula"
  | "reference"
  | "lookup"
  | "rollup"
  | "timer"
  | "time_tracking";

export type CustomFieldType =
  | "number"
  | "text"
  | "select"
  | "multi_select"
  | "date"
  | BuiltinFieldType;
export type NumberFormat = "number" | "percent" | "currency" | "custom" | "none";
export type ColumnFunction = "none" | "sum" | "average" | "count" | "min" | "max";

export type CustomFieldConfig = {
  number_format?: NumberFormat;
  currency?: string;
  decimals?: number;
  custom_suffix?: string;
  column_function?: ColumnFunction;
  include_subtasks?: boolean;
  prefix?: string;
  expression?: string;
  source_project_ids?: number[];
  reference_field_id?: number;
  lookup_field_id?: number;
  rollup_field_id?: number;
  rollup_source?: "subtasks" | "reference";
  rollup_function?: ColumnFunction;
  timer_format?: "hours_minutes" | "decimal_hours";
};

export type FieldAccessLevel = "everyone" | "admins" | "custom";

export type CustomField = {
  id: number;
  name: string;
  field_type: CustomFieldType;
  options: string[];
  description?: string;
  config?: CustomFieldConfig;
  access_level?: FieldAccessLevel;
  editor_ids?: number[];
};

export type CustomValue = {
  value_text: string | null;
  value_number: number | null;
  value_date?: string | null;
  value_json?: unknown;
};

export const NUMBER_FORMAT_LABELS: Record<NumberFormat, string> = {
  number: "数値",
  percent: "パーセント",
  currency: "通貨",
  custom: "カスタムラベル",
  none: "なし",
};

export const COLUMN_FUNCTION_LABELS: Record<ColumnFunction, string> = {
  none: "なし",
  sum: "合計",
  average: "平均",
  count: "個数",
  min: "最小値",
  max: "最大値",
};

export const CURRENCY_CHOICES = ["JPY", "USD", "EUR", "GBP", "CNY", "AUD", "CAD", "CHF"] as const;

const NUMBER_FORMATS = new Set<NumberFormat>(["number", "percent", "currency", "custom", "none"]);
const COLUMN_FUNCTIONS = new Set<ColumnFunction>(["none", "sum", "average", "count", "min", "max"]);

function clampDecimals(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(6, Math.max(0, number)) : 0;
}

/** Normalize config read from JSONB or the client. Unknown values are ignored. */
export function normalizeCustomFieldConfig(raw: unknown): CustomFieldConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const config: CustomFieldConfig = {};
  if (typeof value.number_format === "string" && NUMBER_FORMATS.has(value.number_format as NumberFormat)) {
    config.number_format = value.number_format as NumberFormat;
  }
  if (typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency)) {
    config.currency = value.currency;
  }
  if (value.decimals !== undefined) config.decimals = clampDecimals(value.decimals);
  if (typeof value.custom_suffix === "string") config.custom_suffix = value.custom_suffix.slice(0, 24);
  if (typeof value.column_function === "string" && COLUMN_FUNCTIONS.has(value.column_function as ColumnFunction)) {
    config.column_function = value.column_function as ColumnFunction;
  }
  if (typeof value.include_subtasks === "boolean") config.include_subtasks = value.include_subtasks;
  if (typeof value.prefix === "string") config.prefix = value.prefix.slice(0, 16);
  if (typeof value.expression === "string") config.expression = value.expression.slice(0, 500);
  if (Array.isArray(value.source_project_ids)) {
    config.source_project_ids = value.source_project_ids
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)
      .slice(0, 20);
  }
  if (typeof value.reference_field_id === "number" && Number.isInteger(value.reference_field_id)) {
    config.reference_field_id = value.reference_field_id;
  }
  if (typeof value.lookup_field_id === "number" && Number.isInteger(value.lookup_field_id)) {
    config.lookup_field_id = value.lookup_field_id;
  }
  if (typeof value.rollup_field_id === "number" && Number.isInteger(value.rollup_field_id)) {
    config.rollup_field_id = value.rollup_field_id;
  }
  if (value.rollup_source === "subtasks" || value.rollup_source === "reference") {
    config.rollup_source = value.rollup_source;
  }
  if (typeof value.rollup_function === "string" && COLUMN_FUNCTIONS.has(value.rollup_function as ColumnFunction)) {
    config.rollup_function = value.rollup_function as ColumnFunction;
  }
  if (value.timer_format === "hours_minutes" || value.timer_format === "decimal_hours") {
    config.timer_format = value.timer_format;
  }
  return config;
}

export type CustomFieldConfigResult =
  | { ok: true; config: CustomFieldConfig }
  | { ok: false; error: string };

/** Strict validation used by the custom-field API. */
export function parseCustomFieldConfig(
  fieldType: CustomFieldType,
  raw: unknown,
): CustomFieldConfigResult {
  if (fieldType === "timer") {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const timerFormat = value.timer_format === "decimal_hours" ? "decimal_hours" : "hours_minutes";
    return { ok: true, config: { timer_format: timerFormat } };
  }
  if (fieldType === "reference") {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const ids = Array.isArray(value.source_project_ids)
      ? value.source_project_ids
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item > 0)
          .slice(0, 20)
      : [];
    if (ids.length === 0) return { ok: false, error: "source_project_ids is required" };
    return { ok: true, config: { source_project_ids: [...new Set(ids)] } };
  }
  if (fieldType === "lookup") {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const refId = Number(value.reference_field_id);
    const lookupId = Number(value.lookup_field_id);
    if (!Number.isInteger(refId) || refId <= 0) return { ok: false, error: "reference_field_id is required" };
    if (!Number.isInteger(lookupId) || lookupId <= 0) return { ok: false, error: "lookup_field_id is required" };
    return { ok: true, config: { reference_field_id: refId, lookup_field_id: lookupId } };
  }
  if (fieldType === "rollup") {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const source = value.rollup_source === "reference" ? "reference" : "subtasks";
    const fieldId = Number(value.rollup_field_id);
    if (!Number.isInteger(fieldId) || fieldId <= 0) return { ok: false, error: "rollup_field_id is required" };
    const fn = value.rollup_function ?? "sum";
    if (typeof fn !== "string" || !COLUMN_FUNCTIONS.has(fn as ColumnFunction)) {
      return { ok: false, error: "invalid rollup_function" };
    }
    const config: CustomFieldConfig = {
      rollup_source: source,
      rollup_field_id: fieldId,
      rollup_function: fn as ColumnFunction,
    };
    if (source === "reference") {
      const refId = Number(value.reference_field_id);
      if (!Number.isInteger(refId) || refId <= 0) return { ok: false, error: "reference_field_id is required" };
      config.reference_field_id = refId;
    }
    return { ok: true, config };
  }
  if (fieldType === "auto_id") {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const prefix = typeof value.prefix === "string" ? value.prefix.trim().slice(0, 16) : "ID-";
    return { ok: true, config: { prefix: prefix === "" ? "ID-" : prefix } };
  }
  if (fieldType === "formula") {
    if (raw === undefined || raw === null) {
      return {
        ok: true,
        config: {
          expression: "",
          number_format: "number",
          currency: "JPY",
          decimals: 0,
          column_function: "sum",
        },
      };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "config must be an object" };
    }
    const value = raw as Record<string, unknown>;
    const expression = typeof value.expression === "string" ? value.expression.trim().slice(0, 500) : "";
    const numberFormat = value.number_format ?? "number";
    if (typeof numberFormat !== "string" || !NUMBER_FORMATS.has(numberFormat as NumberFormat)) {
      return { ok: false, error: "invalid number_format" };
    }
    const currency = value.currency ?? "JPY";
    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, error: "invalid currency" };
    }
    const columnFunction = value.column_function ?? "sum";
    if (typeof columnFunction !== "string" || !COLUMN_FUNCTIONS.has(columnFunction as ColumnFunction)) {
      return { ok: false, error: "invalid column_function" };
    }
    return {
      ok: true,
      config: {
        expression,
        number_format: numberFormat as NumberFormat,
        currency,
        decimals: clampDecimals(value.decimals),
        custom_suffix: typeof value.custom_suffix === "string" ? value.custom_suffix.slice(0, 24) : "",
        column_function: columnFunction as ColumnFunction,
        include_subtasks: value.include_subtasks === true,
      },
    };
  }
  if (fieldType !== "number") return { ok: true, config: {} };
  if (raw === undefined || raw === null) {
    return {
      ok: true,
      config: {
        number_format: "number",
        currency: "JPY",
        decimals: 0,
        column_function: "sum",
        include_subtasks: false,
      },
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "config must be an object" };
  }
  const value = raw as Record<string, unknown>;
  const numberFormat = value.number_format ?? "number";
  if (typeof numberFormat !== "string" || !NUMBER_FORMATS.has(numberFormat as NumberFormat)) {
    return { ok: false, error: "invalid number_format" };
  }
  const currency = value.currency ?? "JPY";
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "invalid currency" };
  }
  const decimals = clampDecimals(value.decimals);
  const customSuffix = typeof value.custom_suffix === "string" ? value.custom_suffix.slice(0, 24) : "";
  const columnFunction = value.column_function ?? "sum";
  if (typeof columnFunction !== "string" || !COLUMN_FUNCTIONS.has(columnFunction as ColumnFunction)) {
    return { ok: false, error: "invalid column_function" };
  }
  return {
    ok: true,
    config: {
      number_format: numberFormat as NumberFormat,
      currency,
      decimals,
      custom_suffix: customSuffix,
      column_function: columnFunction as ColumnFunction,
      include_subtasks: value.include_subtasks === true,
    },
  };
}

export function numberFormatOf(field: CustomField): NumberFormat {
  return field.config?.number_format ?? "number";
}

export function isNumericFieldType(type: CustomFieldType): boolean {
  return type === "number" || type === "formula" || type === "rollup";
}

export function columnFunctionOf(field: CustomField): ColumnFunction {
  if (!isNumericFieldType(field.field_type)) return "none";
  return field.config?.column_function ?? "sum";
}

export function formatNumberValue(value: number, config: CustomFieldConfig = {}): string {
  const format = config.number_format ?? "number";
  const decimals = clampDecimals(config.decimals);
  if (!Number.isFinite(value)) return "–";
  if (format === "none") return String(value);
  if (format === "currency") {
    const currency = config.currency ?? "JPY";
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }
  const formatted = new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: format === "percent" ? decimals : decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  if (format === "percent") return `${formatted}%`;
  if (format === "custom") return `${formatted}${config.custom_suffix ?? ""}`;
  return formatted;
}

export function formatDateValue(value: string | null | undefined): string {
  if (!value) return "–";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : value;
}

export function customValueToArray(v?: CustomValue): string[] {
  if (!v || !Array.isArray(v.value_json)) return [];
  return v.value_json.map((item) => String(item));
}

export function formatCustomValue(f: CustomField, v?: CustomValue): string {
  if (!v) return "–";
  if (f.field_type === "number") {
    return v.value_number === null ? "–" : formatNumberValue(v.value_number, f.config ?? {});
  }
  if (f.field_type === "multi_select") {
    const values = customValueToArray(v);
    return values.length > 0 ? values.join(", ") : "–";
  }
  if (f.field_type === "date") return formatDateValue(v.value_date);
  return v.value_text ?? "–";
}

/** Value in the shape consumed by inline editors and filters (empty when unset). */
export function customValueToInput(f: CustomField, v?: CustomValue): string {
  if (!v) return "";
  if (f.field_type === "number") return v.value_number === null ? "" : String(v.value_number);
  if (f.field_type === "multi_select") return JSON.stringify(customValueToArray(v));
  if (f.field_type === "people") return JSON.stringify(customValueToIdArray(v));
  if (f.field_type === "date") return v.value_date ?? "";
  return v.value_text ?? "";
}


/** Fields whose value is derived from task metadata rather than stored. */
const BUILTIN_FIELD_TYPES = new Set<CustomFieldType>([
  "project",
  "completed_on",
  "created_at",
  "modified_at",
  "created_by",
  "collaborators",
  "attachments",
  "blocked_by",
  "blocking",
]);

export function isBuiltinFieldType(type: CustomFieldType): boolean {
  return BUILTIN_FIELD_TYPES.has(type);
}

export function isReadOnlyFieldType(type: CustomFieldType): boolean {
  return (
    type === "auto_id" ||
    type === "formula" ||
    type === "lookup" ||
    type === "rollup" ||
    type === "time_tracking" ||
    isBuiltinFieldType(type)
  );
}

export type CustomFieldTaskMeta = {
  project_name?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  creator_name?: string | null;
  assignee_name?: string | null;
  due_on?: string | null;
  collaborators?: { id: number; name: string }[] | null;
  attachment_count?: number | null;
  blocked_by_count?: number | null;
  blocking_count?: number | null;
};

export function customValueToIdArray(v?: CustomValue): number[] {
  if (!v || !Array.isArray(v.value_json)) return [];
  return v.value_json
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

export function formatPeopleValue(ids: number[], users: { id: number; name: string }[]): string {
  const names = ids
    .map((id) => users.find((user) => user.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : "–";
}

export function timerSeconds(value: CustomValue | undefined, now = Date.now()): number {
  const base = Number(value?.value_number ?? 0);
  const running = value?.value_json;
  const since =
    running && typeof running === "object" && !Array.isArray(running)
      ? (running as Record<string, unknown>).running_since
      : null;
  const started = typeof since === "string" ? Date.parse(since) : NaN;
  const extra = Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : 0;
  return (Number.isFinite(base) ? base : 0) + extra;
}

export function formatDuration(
  seconds: number,
  config: CustomFieldConfig = {},
): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "–";
  if (config.timer_format === "decimal_hours") {
    return `${(seconds / 3600).toFixed(2)} 時間`;
  }
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} 時間 ${String(minutes).padStart(2, "0")} 分`;
}

/** Render a custom field value, including built-in/virtual task columns. */
export function customFieldDisplay(
  field: CustomField,
  value: CustomValue | undefined,
  task: CustomFieldTaskMeta | undefined,
  users: { id: number; name: string }[],
  values?: Record<number, CustomValue>,
  fields?: CustomField[],
): string {
  if (field.field_type === "people") {
    return formatPeopleValue(customValueToIdArray(value), users);
  }
  if (field.field_type === "timer") {
    return formatDuration(timerSeconds(value), field.config ?? {});
  }
  if (field.field_type === "time_tracking") {
    const timerFields = (fields ?? []).filter((item) => item.field_type === "timer");
    if (!values || timerFields.length === 0) return "–";
    const total = timerFields.reduce((sum, item) => sum + timerSeconds(values[item.id]), 0);
    if (total <= 0) return "–";
    return formatDuration(total, { timer_format: "hours_minutes" });
  }
  if (field.field_type === "reference") {
    return value?.value_text ?? "–";
  }
  if (field.field_type === "lookup") {
    return value?.value_text ?? "–";
  }
  if (field.field_type === "rollup") {
    if (value?.value_text) return value.value_text;
    return value?.value_number === null || value?.value_number === undefined
      ? "–"
      : formatNumberValue(Number(value.value_number), field.config ?? {});
  }
  if (field.field_type === "formula") {
    const result = values ? evaluateFormulaField(field, values) : null;
    return result === null ? "–" : formatNumberValue(result, field.config ?? {});
  }
  if (field.field_type === "auto_id") {
    if (value?.value_text) return value.value_text;
    if (value?.value_number !== null && value?.value_number !== undefined) {
      return `${field.config?.prefix ?? "ID-"}${value.value_number}`;
    }
    return "–";
  }
  if (isBuiltinFieldType(field.field_type) && task) {
    if (field.field_type === "project") return task.project_name ?? "–";
    if (field.field_type === "completed_on") return formatDateValue(task.completed_at);
    if (field.field_type === "created_at") return formatDateValue(task.created_at);
    if (field.field_type === "modified_at") return formatDateValue(task.updated_at);
    if (field.field_type === "created_by") return task.creator_name ?? "–";
    if (field.field_type === "collaborators") {
      const names = (task.collaborators ?? []).map((person) => person.name);
      return names.length > 0 ? names.join(", ") : "–";
    }
    if (field.field_type === "attachments") {
      const count = Number(task.attachment_count ?? 0);
      return count > 0 ? `${count}件` : "–";
    }
    if (field.field_type === "blocked_by") {
      const count = Number(task.blocked_by_count ?? 0);
      return count > 0 ? `${count}件` : "–";
    }
    if (field.field_type === "blocking") {
      const count = Number(task.blocking_count ?? 0);
      return count > 0 ? `${count}件` : "–";
    }
  }
  return formatCustomValue(field, value);
}


type FormulaToken =
  | { type: "number"; value: number }
  | { type: "ref"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

function tokenizeFormula(expression: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = expression.slice(index).match(/^\d*\.?\d+/);
      if (!match) throw new Error("invalid number");
      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (char === "{") {
      const close = expression.indexOf("}", index);
      if (close === -1) throw new Error("invalid field reference");
      const raw = expression.slice(index + 1, close).trim();
      const fieldId = Number(raw);
      if (!Number.isInteger(fieldId) || fieldId <= 0) throw new Error("invalid field reference");
      tokens.push({ type: "ref", value: fieldId });
      index = close + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) throw new Error("invalid identifier");
      tokens.push({ type: "ident", value: match[0].toUpperCase() });
      index += match[0].length;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }
    if ("+-*/^".includes(char)) {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }
    throw new Error(`unexpected character: ${char}`);
  }
  return tokens;
}

/** Safe recursive-descent evaluator for the Asana-style formula field. */
export function evaluateFormula(
  expression: string,
  resolveField: (fieldId: number) => number | null,
): number | null {
  if (!expression.trim()) return null;
  let tokens: FormulaToken[];
  try {
    tokens = tokenizeFormula(expression);
  } catch {
    return null;
  }
  let position = 0;
  let blank = false;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  const parsePrimary = (): number => {
    const token = take();
    if (!token) throw new Error("unexpected end");
    if (token.type === "number") return token.value;
    if (token.type === "ref") {
      const value = resolveField(token.value);
      if (value === null || !Number.isFinite(value)) {
        blank = true;
        return 0;
      }
      return value;
    }
    if (token.type === "lparen") {
      const value = parseAdditive();
      const close = take();
      if (!close || close.type !== "rparen") throw new Error("missing paren");
      return value;
    }
    if (token.type === "ident") {
      const next = take();
      if (!next || next.type !== "lparen") throw new Error("expected function call");
      const args: number[] = [];
      if (peek()?.type !== "rparen") {
        for (;;) {
          args.push(parseAdditive());
          const separator = peek();
          if (separator?.type === "comma") {
            take();
            continue;
          }
          break;
        }
      }
      const close = take();
      if (!close || close.type !== "rparen") throw new Error("missing paren");
      return applyFormulaFunction(token.value, args);
    }
    throw new Error("unexpected token");
  };

  const parseUnary = (): number => {
    const token = peek();
    if (token?.type === "op" && (token.value === "+" || token.value === "-")) {
      take();
      const value = parseUnary();
      return token.value === "-" ? -value : value;
    }
    return parsePrimary();
  };

  const parsePower = (): number => {
    const left = parseUnary();
    const token = peek();
    if (token?.type === "op" && token.value === "^") {
      take();
      return Math.pow(left, parsePower());
    }
    return left;
  };

  const parseTerm = (): number => {
    let value = parsePower();
    for (;;) {
      const token = peek();
      if (token?.type !== "op" || (token.value !== "*" && token.value !== "/")) break;
      take();
      const right = parsePower();
      if (token.value === "*") value *= right;
      else {
        if (right === 0) throw new Error("division by zero");
        value /= right;
      }
    }
    return value;
  };

  const parseAdditive = (): number => {
    let value = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.type !== "op" || (token.value !== "+" && token.value !== "-")) break;
      take();
      const right = parseTerm();
      value = token.value === "+" ? value + right : value - right;
    }
    return value;
  };

  try {
    const value = parseAdditive();
    if (position !== tokens.length || blank || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function applyFormulaFunction(name: string, args: number[]): number {
  const first = args[0] ?? 0;
  if (name === "SUM") return args.reduce((sum, value) => sum + value, 0);
  if (name === "AVERAGE" || name === "AVG") return args.length > 0 ? args.reduce((sum, value) => sum + value, 0) / args.length : 0;
  if (name === "MIN") return Math.min(...args);
  if (name === "MAX") return Math.max(...args);
  if (name === "ABS") return Math.abs(first);
  if (name === "CEILING" || name === "CEIL") return Math.ceil(first);
  if (name === "FLOOR") return Math.floor(first);
  if (name === "ROUND") {
    const digits = Math.trunc(args[1] ?? 0);
    const factor = Math.pow(10, Math.max(0, Math.min(6, digits)));
    return Math.round(first * factor) / factor;
  }
  throw new Error(`unknown function: ${name}`);
}

export function evaluateFormulaField(
  field: CustomField,
  values: Record<number, CustomValue>,
): number | null {
  const expression = field.config?.expression ?? "";
  return evaluateFormula(expression, (fieldId) => {
    const value = values[fieldId]?.value_number;
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
  });
}


export function normalizeAccessLevel(value: unknown): FieldAccessLevel {
  return value === "admins" || value === "custom" ? value : "everyone";
}

/** Whether the viewer may change this field's task values. */
export function canEditCustomField(
  field: CustomField,
  viewer: { viewerId: number; canEdit: boolean; canAdmin: boolean },
): boolean {
  if (!viewer.canEdit) return false;
  const level = normalizeAccessLevel(field.access_level);
  if (level === "everyone") return true;
  if (level === "admins") return viewer.canAdmin;
  return viewer.canAdmin || (field.editor_ids ?? []).includes(viewer.viewerId);
}
