export type CustomFieldType = "number" | "text" | "select" | "multi_select" | "date";
export type NumberFormat = "number" | "percent" | "currency" | "custom" | "none";
export type ColumnFunction = "none" | "sum" | "average" | "count" | "min" | "max";

export type CustomFieldConfig = {
  number_format?: NumberFormat;
  currency?: string;
  decimals?: number;
  custom_suffix?: string;
  column_function?: ColumnFunction;
  include_subtasks?: boolean;
};

export type CustomField = {
  id: number;
  name: string;
  field_type: CustomFieldType;
  options: string[];
  description?: string;
  config?: CustomFieldConfig;
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

export function columnFunctionOf(field: CustomField): ColumnFunction {
  if (field.field_type !== "number") return "none";
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
  if (f.field_type === "date") return v.value_date ?? "";
  return v.value_text ?? "";
}
