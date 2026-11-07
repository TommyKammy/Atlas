"use client";

import {
  LIST_SORT_LABELS,
  LIST_SORT_OPTIONS,
  type ListSortKey,
} from "@/lib/list-view";

/** Asana-style sort field picker with direction toggle. */
export default function ListSortMenu({
  sortKey,
  sortDir,
  onSelect,
  onToggleDir,
  onClear,
  hideProject = false,
  allowedKeys,
  showDirection = true,
  includeNone = false,
}: {
  sortKey: ListSortKey;
  sortDir: "asc" | "desc";
  onSelect: (key: Exclude<ListSortKey, "position">) => void;
  onToggleDir: () => void;
  onClear: () => void;
  hideProject?: boolean;
  allowedKeys?: readonly Exclude<ListSortKey, "position">[];
  showDirection?: boolean;
  includeNone?: boolean;
}) {
  const options =
    allowedKeys ??
    (hideProject
      ? LIST_SORT_OPTIONS.filter((key) => key !== "project")
      : LIST_SORT_OPTIONS);
  return (
    <div data-list-sort-menu className="p-1.5">
      <div className="flex items-center justify-between px-1.5 pb-1">
        <span className="text-[13px] font-semibold text-neutral-800">ソート</span>
        <button
          type="button"
          onClick={onClear}
          disabled={sortKey === "position"}
          className="text-[12px] text-[#2c60b8] hover:underline disabled:text-neutral-300 disabled:no-underline"
        >
          クリア
        </button>
      </div>
      {includeNone && (
        <button
          type="button"
          data-list-sort-option="none"
          onClick={onClear}
          className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
        >
          <span className="w-4 text-[#2c60b8]">{sortKey === "position" ? "✓" : ""}</span>
          なし
        </button>
      )}
      {options.map((key) => (
        <button
          key={key}
          type="button"
          data-list-sort-option={key}
          onClick={() => onSelect(key)}
          className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
        >
          <span className="w-4 text-[#2c60b8]">{sortKey === key ? "✓" : ""}</span>
          <span className="min-w-0 flex-1 truncate">{key === "status" ? "Status" : LIST_SORT_LABELS[key]}</span>
          {sortKey === key && (
            <span className="text-[11px] text-neutral-500">{sortDir === "asc" ? "昇順" : "降順"}</span>
          )}
        </button>
      ))}
      {showDirection && sortKey !== "position" && (
        <button
          type="button"
          data-list-sort-dir
          onClick={onToggleDir}
          className="mt-1 flex h-8 w-full items-center justify-between rounded border border-neutral-200 px-2 text-[12px] text-neutral-600 hover:bg-neutral-50"
        >
          <span>並び方向</span>
          <span>{sortDir === "asc" ? "昇順 ↑" : "降順 ↓"}</span>
        </button>
      )}
    </div>
  );
}
