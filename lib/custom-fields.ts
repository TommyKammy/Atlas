export type CustomField = {
  id: number;
  name: string;
  field_type: "number" | "text" | "select";
  options: string[];
};

export type CustomValue = { value_text: string | null; value_number: number | null };

export function formatCustomValue(f: CustomField, v?: CustomValue): string {
  if (!v) return "–";
  if (f.field_type === "number") return v.value_number === null ? "–" : String(v.value_number);
  return v.value_text ?? "–";
}
