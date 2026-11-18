"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { useEffect, useId, useRef, useState } from "react";
import type { RuleEditorOption, RuleOptionKind } from "@/lib/automation/no-code-inputs";

export type RuleEntityPickerProps = {
  projectId: number;
  kind: RuleOptionKind;
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  fieldId?: number;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

export function RuleEntityPicker({ projectId, kind, value, onChange, label, fieldId, disabled, required, invalid, describedBy }: RuleEntityPickerProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [selection, setSelection] = useState<{ key: string; option?: RuleEditorOption }>();
  const [result, setResult] = useState<{ key: string; options: RuleEditorOption[]; hasMore: boolean; error?: string }>();
  const endpoint = `/api/projects/${projectId}/rules/options`;
  const context = `${projectId}/${kind}/${fieldId ?? ""}`;
  const selectionKey = `${context}/${value ?? ""}`;
  const resultKey = `${context}/${query}`;
  const options = result?.key === resultKey ? result.options : [];
  const current = selection?.key === selectionKey ? selection.option : undefined;
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    if (value === null) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ kind, ids: String(value), ...(fieldId ? { field_id: String(fieldId) } : {}) });
    fetch(`${endpoint}?${params}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ options: RuleEditorOption[] }> : { options: [] })
      .then((data) => {
        if (!controller.signal.aborted) setSelection({ key: selectionKey, option: data.options.find((option) => option.value === value) });
      })
      .catch(() => { if (!controller.signal.aborted) setSelection({ key: selectionKey }); });
    return () => controller.abort();
  }, [endpoint, kind, fieldId, value, selectionKey]);

  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ kind, q: query, ...(fieldId ? { field_id: String(fieldId) } : {}) });
      try {
        const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("search failed");
        const data = await response.json() as { options: RuleEditorOption[]; hasMore: boolean };
        if (!controller.signal.aborted) setResult({ key: resultKey, options: data.options, hasMore: data.hasMore });
      } catch {
        if (!controller.signal.aborted) setResult({ key: resultKey, options: [], hasMore: false, error: "候補を読み込めませんでした。検索し直してください。" });
      }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [endpoint, kind, query, fieldId, open, disabled, resultKey]);

  function choose(option: RuleEditorOption) {
    setSelection({ key: `${context}/${option.value}`, option });
    onChange(option.value);
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => input.current?.select());
  }

  const selectedLabel = value === null ? "" : current?.label ?? (selection?.key === selectionKey ? "現在の項目を表示できません" : "読み込み中…");
  return (
    <div className="relative min-w-0" data-rule-entity-picker={kind}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-neutral-700">{label}{required ? " *" : ""}</label>
      <div className="flex gap-1">
        <input id={id} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
          aria-invalid={invalid || undefined} aria-describedby={describedBy}
          aria-activedescendant={open && options.length > 0 ? `${id}-${activeIndex}` : undefined}
          aria-required={required} disabled={disabled} value={open ? query : selectedLabel} autoComplete="off"
          placeholder="名前で検索"
          onFocus={() => { setOpen(true); setQuery(""); setActive(0); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return;
            if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              setActive((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
            }
            if (event.key === "Enter" && open) { event.preventDefault(); if (options[activeIndex]) choose(options[activeIndex]); }
          }}
          className="h-9 min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2.5 text-[13px] outline-none focus:border-[#4573d2] focus:ring-2 focus:ring-[#4573d2]/15 disabled:bg-neutral-50" />
        {value !== null && !disabled && <button type="button" aria-label={`${label}をクリア`}
          onClick={() => { onChange(null); setQuery(""); }} className="rounded px-2 text-subtle hover:bg-neutral-100 hover:text-neutral-700">×</button>}
      </div>
      {open && !disabled && (
        <div className="absolute top-full z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-neutral-200 bg-surface p-1 shadow-lg">
          <ul id={`${id}-list`} role="listbox" aria-label={`${label}の候補`}>
            {options.map((option, index) => <li key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value}
              className={`rounded ${index === activeIndex ? "bg-blue-50" : ""}`}>
              <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)} className="w-full px-2.5 py-2 text-left text-[13px] text-neutral-800">
                <span className="block break-words">{option.label}</span>
                {option.description && <span className="mt-0.5 block text-[11px] text-muted">{option.description}</span>}
              </button>
            </li>)}
          </ul>
          {result?.key !== resultKey && <p role="status" className="px-2 py-3 text-[12px] text-muted">検索中…</p>}
          {result?.key === resultKey && result.error && <p role="alert" className="px-2 py-3 text-[12px] text-rose-600">{result.error}</p>}
          {result?.key === resultKey && !result.error && options.length === 0 && <p role="status" className="px-2 py-3 text-[12px] text-muted">該当する項目がありません</p>}
          {result?.key === resultKey && result.hasMore && <p className="border-t border-neutral-100 px-2 py-2 text-[11px] text-muted">名前を入力すると、候補を絞り込めます。</p>}
        </div>
      )}
    </div>
  );
}

export default RuleEntityPicker;
