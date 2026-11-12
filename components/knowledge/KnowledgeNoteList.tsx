"use client";

import { useId } from "react";
import { useListReorder } from "@/lib/use-list-reorder";
import ReorderGrip from "../ui/ReorderGrip";
import { createPortal } from "react-dom";
import type { ProjectKnowledge } from "@/lib/data";
import type { NotePlacement } from "@/lib/knowledge-order";

const date = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function KnowledgeNoteList({ notes, selectedId, disabled, canReorder, onSelect, onMove }: {
  notes: ProjectKnowledge[]; selectedId: number | null; disabled: boolean; canReorder: boolean;
  onSelect: (id: number) => void; onMove: (id: number, target: number, placement: NotePlacement) => void;
}) {
  const instructions = useId();
  const { listRef, drag, handleProps } = useListReorder({ ids: notes.map(note => note.id), disabled, onMove });

  return <>
    <p id={instructions} className="sr-only">ハンドルをドラッグして並べ替え。キーボードでは Alt と上下矢印。Escape でドラッグをキャンセル。</p>
    <div ref={listRef} role="navigation" data-reorder-scroll className="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain px-0.5 py-1 lg:max-h-[65vh]" aria-label="ノートを選択">
      {notes.map((note) => {
        const target = drag?.active && drag.target?.id === note.id && drag.id !== note.id ? drag.target.placement : null;
        return <div key={note.id} data-note-row={note.id} data-reorder-id={note.id} className={`group relative flex shrink-0 items-center rounded-md ${selectedId === note.id ? "bg-blue-50 text-blue-800" : "hover:bg-neutral-50"} ${drag?.active && drag.id === note.id ? "opacity-40" : ""}`}>
          {target && <span data-note-drop={target} className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-blue-600 ${target === "before" ? "-top-0.5" : "-bottom-0.5"}`} />}
          {canReorder && <button {...handleProps(note.id, note.title)} data-note-handle={note.id}
            aria-label={`「${note.title}」を並べ替え`} aria-describedby={instructions}
            className="ml-0.5 flex min-h-11 w-7 shrink-0 touch-none items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-blue-600 aria-disabled:opacity-30">
            <ReorderGrip />
          </button>}
          <button data-knowledge-note={note.id} aria-current={selectedId === note.id ? "page" : undefined} disabled={disabled}
            onClick={() => onSelect(note.id)} className="min-w-0 flex-1 rounded-md px-2 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-600">
            <span className="block truncate text-sm font-medium">{note.title}</span>
            <span className="mt-1 block text-xs text-neutral-600">{date(note.updated_at)}</span>
          </button>
        </div>;
      })}
    </div>
    {drag?.active && createPortal(<div aria-hidden="true" className="pointer-events-none fixed z-50 max-w-60 truncate rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-blue-800 shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>{drag.title}</div>, document.body)}
  </>;
}
