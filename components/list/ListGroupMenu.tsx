"use client";

import {
  LIST_GROUP_LABELS,
  LIST_GROUP_OPTIONS,
  type ListGroupBy,
} from "@/lib/list-view";

/** Asana-style group field picker. */
export default function ListGroupMenu({
  groupBy,
  statusFieldEnabled,
  onSelect,
  onClear,
}: {
  groupBy: ListGroupBy;
  statusFieldEnabled: boolean;
  onSelect: (key: ListGroupBy) => void;
  onClear: () => void;
}) {
  const options = LIST_GROUP_OPTIONS.filter((key) => key !== "status" || statusFieldEnabled);
  return (
    <div data-list-group-menu className="p-1.5">
      <div className="flex items-center justify-between px-1.5 pb-1">
        <span className="text-[13px] font-semibold text-neutral-800">グループ</span>
        <button
          type="button"
          onClick={onClear}
          disabled={groupBy === "section"}
          className="text-[12px] text-[#2c60b8] hover:underline disabled:text-neutral-300 disabled:no-underline"
        >
          クリア
        </button>
      </div>
      <button
        type="button"
        data-list-group-option="section"
        onClick={() => onSelect("section")}
        className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
      >
        <span className="w-4 text-[#2c60b8]">{groupBy === "section" ? "✓" : ""}</span>
        セクション
      </button>
      {options.map((key) => (
        <button
          key={key}
          type="button"
          data-list-group-option={key}
          onClick={() => onSelect(key)}
          className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
        >
          <span className="w-4 text-[#2c60b8]">{groupBy === key ? "✓" : ""}</span>
          <span className="min-w-0 flex-1 truncate">{LIST_GROUP_LABELS[key]}</span>
        </button>
      ))}
    </div>
  );
}
