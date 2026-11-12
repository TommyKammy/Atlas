"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { ProjectKnowledge } from "@/lib/data";
import type { NotePlacement } from "@/lib/knowledge-order";

type Target = { id: number; placement: NotePlacement };
type Drag = { id: number; pointerId: number; title: string; startX: number; startY: number; x: number; y: number; active: boolean; target: Target | null };
const date = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function KnowledgeNoteList({ notes, selectedId, disabled, canReorder, onSelect, onMove }: {
  notes: ProjectKnowledge[]; selectedId: number | null; disabled: boolean; canReorder: boolean;
  onSelect: (id: number) => void; onMove: (id: number, target: number, placement: NotePlacement) => void;
}) {
  const instructions = useId();
  const nav = useRef<HTMLElement>(null);
  const current = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = drag !== null;
  const targetAt = (x: number, y: number): Target | null => {
    const list = nav.current;
    if (!list) return null;
    const bounds = list.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-note-row]"));
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (y < rect.bottom) return { id: Number(row.dataset.noteRow), placement: y < rect.top + rect.height / 2 ? "before" : "after" };
    }
    const last = rows.at(-1);
    return last ? { id: Number(last.dataset.noteRow), placement: "after" } : null;
  };
  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); current.current = null; setDrag(null); }
    };
    let frame = 0;
    let lastTime = 0;
    const scroll = (time: number) => {
      const item = current.current, list = nav.current;
      if (item?.active && list) {
        const bounds = list.getBoundingClientRect();
        if (item.x >= bounds.left && item.x <= bounds.right && item.y >= bounds.top && item.y <= bounds.bottom) {
          const speed = item.y < bounds.top + 36 ? -Math.min(1, (bounds.top + 36 - item.y) / 36)
            : item.y > bounds.bottom - 36 ? Math.min(1, (item.y - bounds.bottom + 36) / 36) : 0;
          const before = list.scrollTop;
          list.scrollTop += speed * Math.min(time - (lastTime || time), 32) * 0.5;
          if (before !== list.scrollTop) {
            const next = { ...item, target: targetAt(item.x, item.y) };
            current.current = next; setDrag(next);
          }
        }
      }
      lastTime = time; frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    window.addEventListener("keydown", cancel);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", cancel); };
  }, [dragging]);
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const item = current.current;
    if (!item || event.pointerId !== item.pointerId) return;
    const active = item.active || Math.hypot(event.clientX - item.startX, event.clientY - item.startY) > 5;
    const next = { ...item, x: event.clientX, y: event.clientY, active, target: active ? targetAt(event.clientX, event.clientY) : null };
    current.current = next; setDrag(next);
  };
  const cancel = () => { current.current = null; setDrag(null); };

  return <>
    <p id={instructions} className="sr-only">ハンドルをドラッグして並べ替え。キーボードでは Alt と上下矢印。Escape でドラッグをキャンセル。</p>
    <nav ref={nav} className="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain px-0.5 py-1 lg:max-h-[65vh]" aria-label="ノートを選択">
      {notes.map((note, index) => {
        const target = drag?.active && drag.target?.id === note.id && drag.id !== note.id ? drag.target.placement : null;
        return <div key={note.id} data-note-row={note.id} className={`group relative flex shrink-0 items-center rounded-md ${selectedId === note.id ? "bg-blue-50 text-blue-800" : "hover:bg-neutral-50"} ${drag?.active && drag.id === note.id ? "opacity-40" : ""}`}>
          {target && <span data-note-drop={target} className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-blue-600 ${target === "before" ? "-top-0.5" : "-bottom-0.5"}`} />}
          {canReorder && <button type="button" data-note-handle={note.id} aria-disabled={disabled || notes.length < 2}
            aria-label={`「${note.title}」を並べ替え`} aria-describedby={instructions} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            title="ドラッグして並べ替え（Alt + ↑ / ↓）"
            className="ml-0.5 flex min-h-11 w-7 shrink-0 touch-none items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-blue-600 aria-disabled:opacity-30"
            style={{ cursor: disabled || notes.length < 2 ? "default" : drag?.id === note.id ? "grabbing" : "grab" }}
            onPointerDown={event => {
              if (disabled || notes.length < 2 || event.button !== 0 || !event.isPrimary || current.current) return;
              event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
              const item: Drag = { id: note.id, pointerId: event.pointerId, title: note.title, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, target: null };
              current.current = item; setDrag(item);
            }} onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={cancel}
            onPointerUp={event => {
              const item = current.current;
              if (!item || item.pointerId !== event.pointerId) return;
              const target = targetAt(event.clientX, event.clientY);
              cancel();
              if (item?.active && target && item.id !== target.id) onMove(item.id, target.id, target.placement);
            }} onKeyDown={event => {
              if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
              event.preventDefault();
              if (disabled || current.current) return;
              const target = notes[index + (event.key === "ArrowUp" ? -1 : 1)];
              if (target) onMove(note.id, target.id, event.key === "ArrowUp" ? "before" : "after");
            }}>
            <svg aria-hidden="true" width="14" height="18" viewBox="0 0 14 18" fill="currentColor"><circle cx="4" cy="4" r="1.4" /><circle cx="10" cy="4" r="1.4" /><circle cx="4" cy="9" r="1.4" /><circle cx="10" cy="9" r="1.4" /><circle cx="4" cy="14" r="1.4" /><circle cx="10" cy="14" r="1.4" /></svg>
          </button>}
          <button data-knowledge-note={note.id} aria-current={selectedId === note.id ? "page" : undefined} disabled={disabled}
            onClick={() => onSelect(note.id)} className="min-w-0 flex-1 rounded-md px-2 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-600">
            <span className="block truncate text-sm font-medium">{note.title}</span>
            <span className="mt-1 block text-xs text-neutral-600">{date(note.updated_at)}</span>
          </button>
        </div>;
      })}
    </nav>
    {drag?.active && createPortal(<div aria-hidden="true" className="pointer-events-none fixed z-50 max-w-60 truncate rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-blue-800 shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>{drag.title}</div>, document.body)}
  </>;
}
