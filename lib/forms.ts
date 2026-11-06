export type FormFieldType = "text" | "textarea" | "select" | "date" | "number";

export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
};

export type ProjectForm = {
  id: number;
  project_id: number;
  name: string;
  description: string;
  fields: FormField[];
  published: boolean;
  response_count: number;
  created_at: string;
  updated_at: string;
};

export const FORM_FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "1行テキスト" },
  { value: "textarea", label: "複数行テキスト" },
  { value: "select", label: "単一選択" },
  { value: "date", label: "日付" },
  { value: "number", label: "数値" },
];

export const DEFAULT_FORM_FIELDS: FormField[] = [
  { key: "title", label: "タスク名", type: "text", required: true, options: [] },
  { key: "details", label: "詳細", type: "textarea", required: false, options: [] },
  { key: "due_on", label: "期日", type: "date", required: false, options: [] },
];

const TYPES = new Set<FormFieldType>(["text", "textarea", "select", "date", "number"]);

function slug(value: string, index: number) {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return key === "" ? `field_${index}` : key;
}

/** Validate and normalize form fields. Returns null when the definition is invalid. */
export function normalizeFormFields(input: unknown): FormField[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) return null;
  const seen = new Set<string>();
  const fields: FormField[] = [];
  for (const [index, raw] of input.entries()) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim().slice(0, 120) : "";
    if (label === "") return null;
    const typeRaw = typeof item.type === "string" ? item.type : "text";
    const type: FormFieldType = TYPES.has(typeRaw as FormFieldType)
      ? (typeRaw as FormFieldType)
      : "text";
    let key = index === 0 ? "title" : slug(typeof item.key === "string" ? item.key : label, index);
    while (seen.has(key)) key = `${key}_${index}`;
    seen.add(key);
    const options =
      type === "select" && Array.isArray(item.options)
        ? item.options
            .map((option) => String(option).trim())
            .filter(Boolean)
            .slice(0, 30)
        : [];
    fields.push({
      key,
      label,
      type: index === 0 ? "text" : type,
      required: index === 0 ? true : Boolean(item.required),
      options,
    });
  }
  return fields;
}
