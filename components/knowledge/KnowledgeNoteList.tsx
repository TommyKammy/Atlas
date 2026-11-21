"use client";

import { useId } from "react";
import { useListReorder } from "@/lib/use-list-reorder";
import { createPortal } from "react-dom";
import type { ProjectKnowledge } from "@/lib/data";
import type { NotePlacement } from "@/lib/knowledge-order";

const date = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function KnowledgeNoteList({ notes, selectedId, disabled, canReorder, onSelect, onMove }: {
  notes: ProjectKnowledge[]; selectedId: number | null; disabled: boolean; canReorder: boolean;
  onSelect: (id: number) => void; onMove: (id: number, target: number, placement: NotePlacement) => void;
}) {
  const instructions = useId();
  const { listRef, drag, itemProps } = useListReorder({ ids: notes.map(note => note.id), disabled: disabled || !canReorder, onMove });

  return <>
    <p id={instructions} className="sr-only">ノート名をクリックして開く、ドラッグして並べ替え。キーボードでは Alt と上下矢印。Escape でドラッグをキャンセル。</p>
    <div ref={listRef} role="navigation" data-reorder-scroll className="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain px-0.5 py-1 lg:max-h-[65vh]" aria-label="ノートを選択">
      {notes.map((note) => {
        const target = drag?.active && drag.target?.id === note.id && drag.id !== note.id ? drag.target.placement : null;
        return <div key={note.id} data-note-row={note.id} data-reorder-id={note.id} className={`group relative flex shrink-0 items-center rounded-md ${selectedId === note.id ? "bg-nav-active text-sidebar-text-strong" : "hover:bg-hover"} ${drag?.active && drag.id === note.id ? "opacity-40" : ""}`}>
          {target && <span data-note-drop={target} className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-accent ${target === "before" ? "-top-0.5" : "-bottom-0.5"}`} />}
          <button {...(canReorder ? itemProps<HTMLButtonElement>(note.id, note.title) : {})}
            type="button" data-knowledge-note={note.id} data-note-reorder={canReorder ? note.id : undefined}
            aria-describedby={canReorder ? instructions : undefined} aria-current={selectedId === note.id ? "page" : undefined} aria-disabled={disabled}
            onClick={() => { if (!disabled) onSelect(note.id); }} className="min-w-0 flex-1 rounded-md px-2 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-focus-ring">
            <span data-reorder-label={canReorder ? true : undefined} className="block truncate text-[13px] font-medium" style={canReorder ? { touchAction: "none" } : undefined}>{note.title}</span>
            <span className="mt-1 block text-[12px] text-muted">{date(note.updated_at)}</span>
          </button>
        </div>;
      })}
    </div>
    {drag?.active && createPortal(<div aria-hidden="true" className="pointer-events-none fixed z-50 max-w-60 truncate rounded-md border border-accent-line bg-surface px-3 py-2 text-sm text-accent-text shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>{drag.title}</div>, document.body)}
  </>;
}
