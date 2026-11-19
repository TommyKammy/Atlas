"use client";

import { useState } from "react";
import type { CustomField } from "@/lib/custom-fields";
import type { DescriptorOption } from "@/lib/automation/descriptors";
import ReferencePicker from "../fields/ReferencePicker";
import {
  checkboxClass,
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  SelectControl,
} from "../ui/form-controls";

/** Use the same stored value shapes as the task's custom-field editors. */
export default function AutomationCustomFieldValue({ field, users, value, onChange }: {
  field: CustomField | undefined;
  users: DescriptorOption[];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [referenceOpen, setReferenceOpen] = useState(false);
  if (!field) return <p className={`mt-1 ${fieldHintClass}`}>編集できるフィールドを選択してください。</p>;
  const label = <span className={fieldLabelClass}>値</span>;
  const selectedIds = Array.isArray(value) ? value.map(Number) : [];

  if (field.field_type === "reference") {
    return (
      <div className="relative" data-automation-custom-value="reference">
        {label}
        <button type="button" className={`${fieldControlClass} mt-1 text-left`} onClick={() => setReferenceOpen(true)}>
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
        <legend className={`${fieldLabelClass} mb-1`}>値</legend>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-surface-subtle p-2">
          {options.length === 0 && <p className="text-[12px] text-muted">選択肢がありません</p>}
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-[12px] text-secondary">
              <input type="checkbox" className={checkboxClass} checked={selected.some((entry) => entry === option.value)}
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
        <SelectControl containerClassName="mt-1" value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}>
          <option value="">値をクリア</option>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </SelectControl>
      ) : (
        <input type={field.field_type === "date" ? "date" : field.field_type === "number" ? "number" : "text"}
          className={`${fieldControlClass} mt-1`} step={field.field_type === "number" ? "any" : undefined}
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}
