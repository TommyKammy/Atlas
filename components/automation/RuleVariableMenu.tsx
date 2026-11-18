"use client";

import { useRef, useState } from "react";
import { compatibleRuleVariables, type RuleVariable, type RuleVariableTarget } from "@/lib/automation/no-code-inputs";

export default function RuleVariableMenu({ variables, target = "text", onSelect }: {
  variables: RuleVariable[];
  target?: RuleVariableTarget;
  onSelect: (variable: RuleVariable) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const available = compatibleRuleVariables(variables, target).filter((variable) =>
    `${variable.group} ${variable.label}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <details ref={details} className="relative mt-1" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget) && details.current) details.current.open = false;
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && details.current?.open) {
        event.preventDefault(); event.stopPropagation(); details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }
    }}>
      <summary className="w-fit cursor-pointer rounded px-1 py-0.5 text-[11px] text-accent-text hover:bg-accent-soft">変数を挿入</summary>
      <div className="absolute right-0 z-40 mt-1 w-64 max-w-[calc(100vw-3rem)] rounded-lg border border-line bg-surface p-2 shadow-lg">
        <input aria-label="変数を検索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="変数を検索"
          className="mb-1 h-8 w-full rounded border border-line px-2 text-[12px] outline-none focus:border-accent" />
        <div className="max-h-56 overflow-auto">
          {available.length === 0 && <p className="p-2 text-[12px] text-muted">この値に使える変数がありません</p>}
          {available.map((variable) => <button key={variable.path} type="button" onClick={() => {
            onSelect(variable); if (details.current) details.current.open = false;
          }} className="block w-full rounded px-2 py-1.5 text-left text-[12px] hover:bg-accent-soft">
            <span className="block text-text">{variable.label}</span>
            <span className="text-[10px] text-muted">{variable.group}</span>
          </button>)}
        </div>
      </div>
    </details>
  );
}
