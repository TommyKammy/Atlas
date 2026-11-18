"use client";

import { useState } from "react";
import type { CustomField } from "@/lib/custom-fields";
import type { DescriptorOption } from "@/lib/automation/descriptors";
import ReferencePicker from "../fields/ReferencePicker";

const inputClass = "mt-1 h-8 w-full rounded-md border border-line bg-white px-2 text-[12px] outline-none focus:border-accent";

/** Use the same stored value shapes as the task's custom-field editors. */
export default function AutomationCustomFieldValue({ field, users, value, onChange }: {
  field: CustomField | undefined;
  users: DescriptorOption[];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [referenceOpen, setReferenceOpen] = useState(false);
  if (!field) return <p className="mt-1 text-[12px] text-muted">編集できるフィールドを選択してください。</p>;
  const label = <span className="block text-[11px] font-medium text-secondary">値</span>;
  const selectedIds = Array.isArray(value) ? value.map(Number) : [];

  if (field.field_type === "reference") {
    return (
      <div className="relative" data-automation-custom-value="reference">
        {label}
        <button type="button" className={`${inputClass} text-left`} onClick={() => setReferenceOpen(true)}>
          参照タスクを選択（{selectedIds.length}件）
        </button>
        {referenceOpen && (
          <ReferencePicker key={field.id} field={field} initial={selectedIds}
            onSave={(ids) => { onChange(ids); setReferenceOpen(false); }}
            onCancel={() => setReferenceOpen(false)} />
        )}
      </div>
    );
  }

  if (field.field_type === "people" || field.field_type === "multi_select") {
    const people = field.field_type === "people";
    const options = people ? users : field.options.map((option) => ({ value: option, label: option }));
    const selected = people ? selectedIds : Array.isArray(value)
      ? value.map(String)
      : typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
    return (
      <fieldset className="min-w-0" data-automation-custom-value={field.field_type}>
        <legend className="text-[11px] font-medium text-secondary">値</legend>
        <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-line bg-surface p-2">
          {options.length === 0 && <p className="text-[12px] text-subtle">選択肢がありません</p>}
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-[12px] text-secondary">
              <input type="checkbox" checked={selected.some((entry) => entry === option.value)}
                onChange={(event) => onChange(event.target.checked
                  ? [...selected, option.value] : selected.filter((entry) => entry !== option.value))} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <label className="block" data-automation-custom-value={field.field_type}>
      {label}
      {field.field_type === "select" ? (
        <select className={inputClass} value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}>
          <option value="">値をクリア</option>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input type={field.field_type === "date" ? "date" : field.field_type === "number" ? "number" : "text"}
          className={inputClass} step={field.field_type === "number" ? "any" : undefined}
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}
