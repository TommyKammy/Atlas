"use client";

import { useEffect, useState } from "react";
import type { RuleEditorOption, RuleOptionKind, RuleVariable } from "@/lib/automation/no-code-inputs";
import { insertRuleVariable, ruleCollectionValues } from "@/lib/automation/no-code-inputs";
import RuleEntityPicker from "./RuleEntityPicker";
import RuleVariableMenu from "./RuleVariableMenu";

export default function RuleMultiEntityPicker({ projectId, kind, fieldId, value, onChange, label, variables, allowScalar = false, invalid, describedBy }: {
  projectId: number;
  kind: RuleOptionKind;
  fieldId?: number;
  value: unknown;
  onChange: (value: unknown[]) => void;
  label: string;
  variables?: RuleVariable[];
  allowScalar?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const selected = ruleCollectionValues(value, { scalar: allowScalar });
  const ids = selected.filter((entry) => Number.isSafeInteger(Number(entry)) && Number(entry) > 0).map(Number).slice(0, 50);
  const idKey = ids.join(",");
  const key = `${projectId}/${kind}/${fieldId ?? ""}/${idKey}`;
  const [labels, setLabels] = useState<{ key: string; options: RuleEditorOption[] }>();
  useEffect(() => {
    if (!idKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ kind, ids: idKey, ...(fieldId ? { field_id: String(fieldId) } : {}) });
    fetch(`/api/projects/${projectId}/rules/options?${params}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ options: RuleEditorOption[] }> : { options: [] })
      .then((data) => { if (!controller.signal.aborted) setLabels({ key, options: data.options }); })
      .catch(() => { if (!controller.signal.aborted) setLabels({ key, options: [] }); });
    return () => controller.abort();
  }, [projectId, kind, fieldId, idKey, key]);
  return (
    <div className="min-w-0 space-y-2">
      <RuleEntityPicker projectId={projectId} kind={kind} fieldId={fieldId} value={null} label={label}
        invalid={invalid} describedBy={describedBy}
        onChange={(id) => { if (id !== null && !selected.some((entry) => Number(entry) === id)) onChange([...selected, id]); }} />
      {selected.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label={`${label}の選択済み項目`}>
        {selected.map((entry, index) => {
          const variable = variables?.find((item) => `{{${item.path}}}` === entry);
          const name = variable?.label ?? (labels?.key === key ? labels.options.find((option) => option.value === Number(entry))?.label : undefined) ?? "選択済みの項目";
          return <li key={index} className="flex max-w-full items-center gap-1 rounded-full bg-neutral-100 py-1 pl-2.5 pr-1 text-[12px]">
            <span className="truncate">{name}</span>
            <button type="button" aria-label={`${name}を削除`} onClick={() => onChange(selected.filter((_, item) => item !== index))}
              className="rounded-full px-1.5 text-neutral-500 hover:bg-neutral-200">×</button>
          </li>;
        })}
      </ul>}
      {variables && <RuleVariableMenu variables={variables} target="id_collection"
        onSelect={(variable) => onChange(insertRuleVariable(selected, variable, "id_collection") as unknown[])} />}
      {!allowScalar && !Array.isArray(value) && value != null && value !== "" && <p className="text-[11px] text-neutral-500">保存済みの値を保持しています。項目を選ぶと置き換わります。</p>}
      <button type="button" onClick={() => onChange([])} className="text-[11px] text-neutral-500 hover:text-neutral-800">選択をクリア</button>
    </div>
  );
}
