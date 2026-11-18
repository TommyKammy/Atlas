"use client";

import { type MouseEvent, type ReactNode } from "react";

/** Column header row including column drag/drop targets and the add-field button. */
export default function ListColumnHeaderRow({
  gridCols,
  compactCells,
  allSelected,
  onToggleAll,
  columnDragging,
  onClearColumnDrop,
  onEndColumnDrag,
  headers,
  onAddField,
}: {
  gridCols: string;
  compactCells: string;
  allSelected: boolean;
  onToggleAll: () => void;
  columnDragging: boolean;
  onClearColumnDrop: () => void;
  onEndColumnDrag: () => void;
  headers: ReactNode;
  onAddField: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className={`grid h-[37px] items-center [&>*:nth-child(n+3)]:border-l [&>*:nth-child(n+3)]:border-[#eaeaea] border-b border-line px-2 text-xs font-normal text-muted ${compactCells}`}
      style={{ gridTemplateColumns: gridCols }}
      onDragOver={(event) => {
        if (!columnDragging) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(event) => {
        const related = event.relatedTarget as Node | null;
        if (related && event.currentTarget.contains(related)) return;
        onClearColumnDrop();
      }}
      onDrop={(event) => {
        if (!columnDragging) return;
        event.preventDefault();
        onEndColumnDrag();
      }}
    >
      <input
        type="checkbox"
        title="すべて選択/解除"
        checked={allSelected}
        onChange={onToggleAll}
      />
      {headers}
      <button
        type="button"
        style={{ order: 999 }}
        data-field-add-button
        aria-label="フィールドを追加"
        onClick={onAddField}
        title="フィールドを追加"
        className="flex h-6 w-6 items-center justify-center justify-self-end rounded text-[15px] text-muted hover:bg-hover hover:text-text"
      >
        ＋
      </button>
    </div>
  );
}
