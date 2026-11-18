"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskTemplate, User } from "@/lib/data";
import { api } from "@/lib/api-client";
import { isImeComposing } from "@/lib/ime-keyboard";
import { ViewAddButton, viewToolbarActionClass } from "../view/ProjectViewToolbar";
import { useQuickTask } from "./QuickTaskContext";

export default function ProjectTaskCreateButton({ projectId, sections: _sections, users: _users,
  templates = [], onTemplate, ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  projectId: number; sections: Section[]; users: User[]; templates?: TaskTemplate[]; onTemplate?: (id: number) => void;
}) {
  // These view props are deliberately excluded from DOM button attributes.
  void _sections; void _users;
  const quick = useQuickTask();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLSpanElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const choose = (kind: "task" | "approval" | "milestone") => { setOpen(false); quick?.create(kind); };
  const saveSection = async () => {
    if (!section?.trim() || busy) return;
    setBusy(true); setError("");
    try { await api("/api/sections", "POST", { project_id: projectId, name: section.trim() }); setOpen(false); setSection(null); router.refresh(); }
    catch { setError("セクションを追加できませんでした。もう一度お試しください。"); }
    finally { setBusy(false); }
  };
  return <span ref={root} className="relative inline-flex shrink-0" onKeyDown={event => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus(); }
    if (section === null && open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <ViewAddButton {...buttonProps} className={`rounded-r-none ${buttonProps.className ?? ""}`} onClick={() => choose("task")} />
    <button ref={toggle} type="button" aria-label="追加オプション" aria-haspopup="menu" aria-expanded={open}
      disabled={buttonProps.disabled} className={`${viewToolbarActionClass} rounded-l-none border-l-0 px-1.5`}
      onClick={() => { setOpen(!open); setSection(null); setError(""); }}
      onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}>▾</button>
    {open && <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-line bg-surface p-1 text-[13px] text-text shadow-lg">
      {section === null ? <div role="menu" aria-label="追加の種類">
        {([['task', '○', 'タスク'], ['approval', '✓', '承認リクエスト'], ['milestone', '◇', 'マイルストーン'], ['section', '☷', 'セクション']] as const).map(([kind, icon, label], index) =>
          <button key={kind} autoFocus={index === 0} type="button" role="menuitem" className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-neutral-100 focus:bg-blue-50 focus:outline-none"
            onClick={() => kind === "section" ? setSection("") : choose(kind)}><span aria-hidden className="w-4 text-center text-muted">{icon}</span>{label}</button>)}
        {templates.length > 0 && <div className="mt-1 border-t pt-1"><p className="px-3 py-1 text-xs text-muted">テンプレートから作成</p>{templates.map(template => <button key={template.id} type="button" role="menuitem" className="w-full rounded px-3 py-2 text-left hover:bg-neutral-100" onClick={() => { setOpen(false); onTemplate?.(template.id); }}>{template.name}</button>)}</div>}
      </div> : <form className="space-y-2 p-2" onSubmit={event => { event.preventDefault(); void saveSection(); }}>
        <label className="block text-xs font-medium">セクション名<input autoFocus aria-label="新しいセクション名" value={section} onChange={event => setSection(event.target.value)} disabled={busy} className="mt-2 h-8 w-full rounded border px-2 text-sm outline-blue-600" onKeyDown={event => { if (event.key === "Enter" && isImeComposing(event)) event.preventDefault(); }} /></label>
        <button type="submit" disabled={busy || !section.trim()} className="h-7 rounded bg-accent px-3 text-xs text-white disabled:opacity-50">{busy ? "追加中…" : "セクションを追加"}</button>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </form>}
    </div>}
  </span>;
}
