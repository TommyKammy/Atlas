export type BundleField = {
  name: string;
  field_type: "text" | "number" | "select";
  options: string[];
};

export type BundleRule = {
  name: string;
  description: string;
  definition: Record<string, unknown>;
  enabled: boolean;
};

export type Bundle = {
  id: number;
  workspace_id: number;
  name: string;
  description: string;
  fields: BundleField[];
  rules: BundleRule[];
  applied: boolean;
  applied_count: number;
  created_at: string;
  updated_at: string;
};

const TYPES = new Set(["text", "number", "select"]);

export function normalizeBundleFields(input: unknown): BundleField[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) return null;
  const fields: BundleField[] = [];
  const names = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 80) : "";
    const fieldType = typeof item.field_type === "string" ? item.field_type : "text";
    if (name === "" || !TYPES.has(fieldType) || names.has(name)) return null;
    names.add(name);
    const options =
      fieldType === "select" && Array.isArray(item.options)
        ? item.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 30)
        : [];
    fields.push({ name, field_type: fieldType as BundleField["field_type"], options });
  }
  return fields;
}

/** Structural normalization for rule packaging. Semantic validation runs server-side. */
export function normalizeBundleRules(input: unknown): BundleRule[] | null {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 50) return null;
  const rules: BundleRule[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 120) : "";
    const definition = item.definition;
    if (
      name === "" ||
      !definition ||
      typeof definition !== "object" ||
      Array.isArray(definition)
    ) {
      return null;
    }
    rules.push({
      name,
      description:
        typeof item.description === "string" ? item.description.trim().slice(0, 1000) : "",
      definition: definition as Record<string, unknown>,
      enabled: item.enabled !== false,
    });
  }
  return rules;
}
