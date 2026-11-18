"use client";

import type { Section, User } from "@/lib/data";

/** Floating toolbar for bulk task operations. */
export default function ListBulkToolbar({
  selectedCount,
  sections,
  users,
  sectionValue,
  assigneeValue,
  onSectionChange,
  onAssigneeChange,
  onComplete,
  onReopen,
  onMove,
  onAssign,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  sections: Section[];
  users: User[];
  sectionValue: string;
  assigneeValue: string;
  onSectionChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onComplete: () => void;
  onReopen: () => void;
  onMove: (sectionId: number) => void;
  onAssign: (assigneeId: number | null) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      data-bulk-toolbar
      role="toolbar"
      aria-label="複数タスクの一括編集"
      className="fixed bottom-12 left-1/2 z-[75] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-lg bg-[#1e1e1e] px-3 py-2 text-on-accent shadow-[0_0_0_1px_#eaeaea,0_6px_12px_rgba(118,118,118,0.24)]"
    >
      <span aria-live="polite" className="mr-1 whitespace-nowrap px-1 text-[13px] font-semibold">
        {selectedCount} 件のタスクを選択中
      </span>
      <button
        onClick={onComplete}
        className="rounded px-2 py-1 text-[12px] text-neutral-200 hover:bg-white/10"
      >
        完了
      </button>
      <button
        onClick={onReopen}
        className="rounded px-2 py-1 text-[12px] text-neutral-200 hover:bg-white/10"
      >
        未完了
      </button>
      <select
        value={sectionValue}
        onChange={(event) => {
          const value = event.target.value;
          onSectionChange(value);
          if (value) onMove(Number(value));
        }}
        aria-label="セクションを移動"
        className="h-8 rounded border border-white/15 bg-[#2c2c2c] px-2 text-[12px] text-white outline-none"
      >
        <option value="">セクション移動…</option>
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.name}
          </option>
        ))}
      </select>
      <select
        value={assigneeValue}
        onChange={(event) => {
          const value = event.target.value;
          onAssigneeChange(value);
          if (value) onAssign(value === "none" ? null : Number(value));
        }}
        aria-label="担当者を変更"
        className="h-8 rounded border border-white/15 bg-[#2c2c2c] px-2 text-[12px] text-white outline-none"
      >
        <option value="">担当者…</option>
        <option value="none">未割当</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <button
        onClick={onDelete}
        className="rounded px-2 py-1 text-[12px] text-red-300 hover:bg-red-500/15"
      >
        削除
      </button>
      <button
        onClick={onClear}
        aria-label="選択を解除"
        title="選択を解除"
        className="flex h-8 w-8 items-center justify-center rounded text-[18px] leading-none text-neutral-300 hover:bg-white/10 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
