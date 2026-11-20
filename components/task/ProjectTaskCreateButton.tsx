"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import type { Section, TaskTemplate, User } from "@/lib/data";
import { isImeComposing } from "@/lib/ime-keyboard";
import { useSectionDraftStart } from "@/lib/section-draft-context";
import { ViewAddButton, viewToolbarActionClass } from "../view/ProjectViewToolbar";
import { useQuickTask } from "./QuickTaskContext";

export default function ProjectTaskCreateButton({ projectId: _projectId, sections: _sections, users: _users,
  templates = [], onTemplate, ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  projectId: number; sections: Section[]; users: User[]; templates?: TaskTemplate[]; onTemplate?: (id: number) => void;
}) {
  // These view props are deliberately excluded from DOM button attributes.
  void _projectId; void _sections; void _users;
  const quick = useQuickTask();
  const startSection = useSectionDraftStart();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const choose = (kind: "task" | "approval" | "milestone") => { setOpen(false); quick?.create(kind); };
  const kinds = [
    ["task", "○", "タスク"],
    ["approval", "✓", "承認リクエスト"],
    ["milestone", "◇", "マイルストーン"],
    ...(startSection ? [["section", "☷", "セクション"] as const] : []),
  ] as const;
  return <span ref={root} className="relative inline-flex shrink-0" onKeyDown={event => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <ViewAddButton {...buttonProps} className={`rounded-r-none ${buttonProps.className ?? ""}`} onClick={() => choose("task")} />
    <button ref={toggle} type="button" aria-label="追加オプション" aria-haspopup="menu" aria-expanded={open}
      disabled={buttonProps.disabled} className={`${viewToolbarActionClass} rounded-l-none border-l-0 px-1.5`}
      onClick={() => setOpen(!open)}
      onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}>▾</button>
    {open && <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-line bg-surface p-1 text-[13px] text-text shadow-lg">
      <div role="menu" aria-label="追加の種類">
        {kinds.map(([kind, icon, label], index) =>
          <button key={kind} autoFocus={index === 0} type="button" role="menuitem" className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-hover focus:bg-accent-soft focus:outline-none"
            onClick={() => {
              if (kind === "section") { setOpen(false); startSection?.(); }
              else choose(kind);
            }}><span aria-hidden className="w-4 text-center text-muted">{icon}</span>{label}</button>)}
        {templates.length > 0 && <div className="mt-1 border-t pt-1"><p className="px-3 py-1 text-xs text-muted">テンプレートから作成</p>{templates.map(template => <button key={template.id} type="button" role="menuitem" className="w-full rounded px-3 py-2 text-left hover:bg-hover" onClick={() => { setOpen(false); onTemplate?.(template.id); }}>{template.name}</button>)}</div>}
      </div>
    </div>}
  </span>;
}
