"use client";

import { useState } from "react";
import type { DescriptorOption } from "@/lib/automation/descriptors";
import { insertRuleVariable, ruleCollectionValues, type RuleVariable } from "@/lib/automation/no-code-inputs";
import RuleValueField, { ruleInputClass } from "./RuleValueField";
import RuleVariableMenu from "./RuleVariableMenu";

export default function RuleCollectionField({ label, value, onChange, options, type = "text", variables, commaSeparated = false, invalid, describedBy }: {
  label: string;
  value: unknown;
  onChange: (value: unknown[]) => void;
  options?: DescriptorOption[];
  type?: "text" | "number" | "date" | "datetime" | "boolean";
  variables?: RuleVariable[];
  commaSeparated?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState<unknown>("");
  const [query, setQuery] = useState("");
  const selected = ruleCollectionValues(value, { scalar: true, commaSeparated });
  return (
    <fieldset aria-invalid={invalid || undefined} aria-describedby={describedBy} className="min-w-0 space-y-2">
      <legend className="mb-1 text-[12px] font-medium text-neutral-700">{label}</legend>
      {options ? (
        <div className="rounded-md border border-neutral-200 p-2">
          <input aria-label={`${label}の選択肢を検索`} aria-invalid={invalid || undefined} aria-describedby={describedBy} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="選択肢を検索" className={`${ruleInputClass} mb-2`} />
          <div className="max-h-40 space-y-1 overflow-auto">
            {options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())).map((option) => (
              <label key={String(option.value)} className="flex items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-neutral-50">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={(event) => onChange(event.target.checked
                  ? [...selected, option.value] : selected.filter((entry) => entry !== option.value))} />{option.label}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1"><RuleValueField label="値を追加" value={draft} onChange={setDraft} type={type} invalid={invalid} describedBy={describedBy} /></div>
          <button type="button" disabled={draft === "" || draft == null} onClick={() => {
            onChange(selected.includes(draft) ? selected : [...selected, draft]); setDraft("");
          }} className="h-9 rounded-md border border-neutral-300 px-3 text-[12px] hover:bg-neutral-50 disabled:opacity-40">追加</button>
        </div>
      )}
      {selected.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label={`${label}の設定値`}>
        {selected.map((entry, index) => <li key={index} className="flex max-w-full items-center gap-1 rounded-full bg-neutral-100 py-1 pl-2.5 pr-1 text-[12px]">
          <span className="truncate">{variables?.find((variable) => `{{${variable.path}}}` === entry)?.label ?? (typeof entry === "object" ? "保存済みの値" : entry === true ? "はい" : entry === false ? "いいえ" : String(entry))}</span>
          <button type="button" aria-label={`${label}の${index + 1}件目を削除`} onClick={() => onChange(selected.filter((_, item) => item !== index))}
            className="rounded-full px-1.5 text-neutral-500 hover:bg-neutral-200">×</button>
        </li>)}
      </ul>}
      {variables && <RuleVariableMenu variables={variables} target="text_collection"
        onSelect={(variable) => onChange(insertRuleVariable(selected, variable, "text_collection") as unknown[])} />}
      <button type="button" onClick={() => onChange([])} className="text-[11px] text-neutral-500 hover:text-neutral-800">選択をクリア</button>
    </fieldset>
  );
}
