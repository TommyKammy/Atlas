"use client";

import { useId, useRef } from "react";
import type { DescriptorOption } from "@/lib/automation/descriptors";
import { insertRuleVariable, type RuleVariable } from "@/lib/automation/no-code-inputs";
import {
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  fieldTextareaClass,
  SelectControl,
} from "../ui/form-controls";
import RuleVariableMenu from "./RuleVariableMenu";

/** Rule fields share the C workbench form control; min-w-0 keeps flex rows shrinkable. */
export const ruleInputClass = `${fieldControlClass} min-w-0`;

export default function RuleValueField({ label, value, onChange, type = "text", multiline, options, variables, placeholder, help, invalid, describedBy }: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  type?: "text" | "number" | "date" | "datetime" | "boolean" | "password";
  multiline?: boolean;
  options?: DescriptorOption[];
  variables?: RuleVariable[];
  placeholder?: string;
  help?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const selection = useRef<{ start?: number; end?: number }>({});
  const template = typeof value === "string" && value.includes("{{");
  const scalar = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const inputType = template ? "text" : type === "datetime" ? "datetime-local" : type === "boolean" ? "text" : type;
  let displayed = scalar;
  if (type === "datetime" && scalar && !template) {
    const date = new Date(scalar);
    if (Number.isFinite(date.getTime())) displayed = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const selectOptions = type === "boolean" ? options ?? [{ value: "true", label: "はい" }, { value: "false", label: "いいえ" }] : options;
  function edit(raw: string) {
    if (type === "number" && !template) onChange(raw === "" || !Number.isFinite(Number(raw)) ? raw : Number(raw));
    else if (type === "datetime" && raw && !template && Number.isFinite(new Date(raw).getTime())) onChange(new Date(raw).toISOString());
    else onChange(raw);
  }
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={`${fieldLabelClass} mb-1`}>{label}</label>
      {selectOptions && !template ? (
        <SelectControl id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} value={value === true ? "true" : value === false ? "false" : scalar}
          onChange={(event) => onChange(type === "boolean" && event.target.value !== "" ? event.target.value === "true" : selectOptions.find((option) => String(option.value) === event.target.value)?.value ?? event.target.value)}>
          <option value="">選択してください</option>
          {selectOptions.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
          {scalar && !selectOptions.some((option) => String(option.value) === scalar) && <option value={scalar}>保存済みの値</option>}
        </SelectControl>
      ) : multiline ? (
        <textarea id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} ref={(element) => { input.current = element; }} value={scalar} placeholder={placeholder}
          onSelect={(event) => { selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }}
          onChange={(event) => edit(event.target.value)} className={`${fieldTextareaClass} min-h-24`} />
      ) : (
        <input id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} ref={(element) => { input.current = element; }} type={inputType} value={displayed} placeholder={placeholder}
          step={type === "number" ? "any" : undefined} autoComplete={type === "password" ? "new-password" : "off"}
          onSelect={(event) => { selection.current = { start: event.currentTarget.selectionStart ?? undefined, end: event.currentTarget.selectionEnd ?? undefined }; }}
          onChange={(event) => edit(event.target.value)} className={ruleInputClass} />
      )}
      {variables && type !== "password" && type !== "boolean" && (
        <RuleVariableMenu variables={variables} target={type === "number" ? "number" : type === "date" || type === "datetime" ? "date" : "text"}
          onSelect={(variable) => {
            onChange(insertRuleVariable(value, variable, type === "number" ? "number" : type === "date" || type === "datetime" ? "date" : "text", selectOptions ? 0 : selection.current.start, selectOptions ? scalar.length : selection.current.end));
            requestAnimationFrame(() => input.current?.focus());
          }} />
      )}
      {help && <p className={`mt-1 ${fieldHintClass}`}>{help}</p>}
      {value !== null && typeof value === "object" && <p className={`mt-1 ${fieldHintClass}`}>保存済みの値を保持しています。入力すると置き換わります。</p>}
    </div>
  );
}
