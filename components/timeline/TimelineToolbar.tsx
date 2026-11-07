"use client";

import type { Dispatch, SetStateAction } from "react";
import PopoverMenu from "../ui/PopoverMenu";

export type TimelineSortKey = "default" | "due" | "start" | "name";
export type TimelineMenuKey = "filter" | "sort" | "options" | null;
export type TimelineZoomPreset = { key: string; label: string; dayWidth: number };

export default function TimelineToolbar({
  projectId,
  min,
  linkDay,
  addToday,
  undatedCount,
  undatedOpen,
  setUndatedOpen,
  zoom,
  zoomPreset,
  zoomPresets,
  zoomMenu,
  setZoomMenu,
  changeZoom,
  filterActive,
  menu,
  setMenu,
  hideCompleted,
  setHideCompleted,
  assigneeFilter,
  setAssigneeFilter,
  assigneeNames,
  sortActive,
  sortBy,
  setSortBy,
  optionsActive,
  showWeekends,
  setShowWeekends,
  showDependencies,
  setShowDependencies,
  showCritical,
  setShowCritical,
}: {
  projectId: number;
  min: number;
  linkDay: (day: number) => string;
  addToday: () => void;
  undatedCount: number;
  undatedOpen: boolean;
  setUndatedOpen: Dispatch<SetStateAction<boolean>>;
  zoom: number;
  zoomPreset: TimelineZoomPreset;
  zoomPresets: readonly TimelineZoomPreset[];
  zoomMenu: boolean;
  setZoomMenu: Dispatch<SetStateAction<boolean>>;
  changeZoom: (next: number) => void;
  filterActive: boolean;
  menu: TimelineMenuKey;
  setMenu: Dispatch<SetStateAction<TimelineMenuKey>>;
  hideCompleted: boolean;
  setHideCompleted: (value: boolean) => void;
  assigneeFilter: string;
  setAssigneeFilter: (value: string) => void;
  assigneeNames: string[];
  sortActive: boolean;
  sortBy: TimelineSortKey;
  setSortBy: (value: TimelineSortKey) => void;
  optionsActive: boolean;
  showWeekends: boolean;
  setShowWeekends: (value: boolean) => void;
  showDependencies: boolean;
  setShowDependencies: (value: boolean) => void;
  showCritical: boolean;
  setShowCritical: (value: boolean) => void;
}) {
  const menuButtonClass = (active: boolean, open: boolean) =>
    `flex h-7 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-neutral-100 ${
      open || active ? "bg-[#eff4fd] text-[#2c60b8]" : "text-neutral-700"
    }`;

  return (
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
        <button
          type="button"
          onClick={addToday}
          data-timeline-add
          className="flex h-7 items-center gap-1 rounded-md border border-[#e1e1e1] bg-white px-2.5 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50"
        >
          <span className="text-[15px] leading-none">＋</span> タスクを追加
        </button>
        <a
          href={`/projects/${projectId}?view=timeline&from=${linkDay(min - 30)}`}
          aria-label="前の期間"
          title="前の期間"
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100"
        >
          ‹
        </a>
        <a href={`/projects/${projectId}?view=timeline`} className="flex h-7 items-center rounded-md px-2 text-[13px] text-neutral-700 hover:bg-neutral-100">
          今日
        </a>
        <a
          href={`/projects/${projectId}?view=timeline&from=${linkDay(min + 30)}`}
          aria-label="次の期間"
          title="次の期間"
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100"
        >
          ›
        </a>
        {showCritical && (
          <span className="ml-2 flex items-center gap-1 text-xs text-neutral-500">
            <span className="inline-block h-2.5 w-4 rounded bg-red-200" /> クリティカルパス
          </span>
        )}
        <span className="ml-auto" />
        <button
          type="button"
          data-timeline-undated
          onClick={() => setUndatedOpen((v) => !v)}
          className={`flex h-7 items-center rounded-md px-2 text-[13px] hover:bg-neutral-100 ${
            undatedOpen ? "bg-[#eff4fd] text-[#2c60b8]" : "text-neutral-700"
          }`}
        >
          日付なしのタスク ({undatedCount} 件)
        </button>
        <span className="relative">
          <button
            type="button"
            data-timeline-zoom-level={zoomPreset.label}
            aria-label={`ズームレベル: ${zoomPreset.label}`}
            aria-haspopup="listbox"
            aria-expanded={zoomMenu}
            onClick={() => setZoomMenu((v) => !v)}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-neutral-700 hover:bg-neutral-100"
          >
            {zoomPreset.label}
            <span className="text-[10px] text-neutral-400">▾</span>
          </button>
          {zoomMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setZoomMenu(false)} />
              <div
                data-timeline-zoom-menu
                role="listbox"
                className="absolute top-8 right-0 z-40 w-36 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg"
              >
                {zoomPresets.map((preset, index) => (
                  <button
                    key={preset.key}
                    type="button"
                    role="option"
                    aria-selected={index === zoom}
                    data-timeline-zoom-option={preset.label}
                    onClick={() => {
                      changeZoom(index);
                      setZoomMenu(false);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-neutral-100 ${
                      index === zoom ? "bg-[#eff4fd] text-[#2c60b8]" : "text-neutral-700"
                    }`}
                  >
                    {preset.label}
                    {index === zoom && <span className="text-[11px]">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
        <button
          type="button"
          data-timeline-zoom-out
          aria-label="ズームアウト"
          aria-disabled={zoom === zoomPresets.length - 1}
          title="ズームアウト"
          onClick={() => changeZoom(zoom + 1)}
          disabled={zoom === zoomPresets.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded-md text-base text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
        >
          −
        </button>
        <button
          type="button"
          data-timeline-zoom-in
          aria-label="ズームイン"
          aria-disabled={zoom === 0}
          title="ズームイン"
          onClick={() => changeZoom(zoom - 1)}
          disabled={zoom === 0}
          className="flex h-7 w-7 items-center justify-center rounded-md text-base text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
        >
          ＋
        </button>

        <div className="relative">
          <button
            type="button"
            data-timeline-filter
            onClick={() => setMenu((m) => (m === "filter" ? null : "filter"))}
            className={menuButtonClass(filterActive, menu === "filter")}
            aria-expanded={menu === "filter"}
            aria-haspopup="menu"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2.5 3h11l-4.2 5v4.2L6.7 13V8L2.5 3Z" />
            </svg>
            フィルター
            {filterActive && <span className="h-1.5 w-1.5 rounded-full bg-[#2c60b8]" />}
          </button>
          <PopoverMenu
            open={menu === "filter"}
            onClose={() => setMenu(null)}
            panelClassName="absolute right-0 top-8 z-30 w-60 rounded-lg border border-neutral-200 bg-white p-3 text-[13px] shadow-lg"
            panelProps={{ "data-timeline-filter-menu": true }}
          >
                <label className="flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={hideCompleted}
                    onChange={(e) => setHideCompleted(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  完了済みを非表示
                </label>
                <div className="mt-3 text-[11px] font-medium text-neutral-500">担当者</div>
                <select
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  className="mt-1 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
                >
                  <option value="all">すべての担当者</option>
                  <option value="none">未割り当て</option>
                  {assigneeNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {(hideCompleted || assigneeFilter !== "all") && (
                  <button
                    type="button"
                    onClick={() => {
                      setHideCompleted(false);
                      setAssigneeFilter("all");
                    }}
                    className="mt-3 text-[12px] text-[#2c60b8] hover:underline"
                  >
                    フィルターを解除
                  </button>
                )}
          </PopoverMenu>
        </div>

        <div className="relative">
          <button
            type="button"
            data-timeline-sort
            onClick={() => setMenu((m) => (m === "sort" ? null : "sort"))}
            className={menuButtonClass(sortActive, menu === "sort")}
            aria-expanded={menu === "sort"}
            aria-haspopup="menu"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M4 2.5v11M4 13.5 1.8 11.2M4 13.5l2.2-2.3M9 3h5M9 6.5h4M9 10h3" />
            </svg>
            ソート
            {sortActive && <span className="h-1.5 w-1.5 rounded-full bg-[#2c60b8]" />}
          </button>
          <PopoverMenu
            open={menu === "sort"}
            onClose={() => setMenu(null)}
            panelClassName="absolute right-0 top-8 z-30 w-52 rounded-lg border border-neutral-200 bg-white p-1.5 text-[13px] shadow-lg"
            panelProps={{ "data-timeline-sort-menu": true }}
          >
                {(
                  [
                    ["default", "既定の並び"],
                    ["due", "期日"],
                    ["start", "開始日"],
                    ["name", "名前"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSortBy(key);
                      setMenu(null);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-neutral-100 ${
                      sortBy === key ? "text-[#2c60b8]" : "text-neutral-700"
                    }`}
                  >
                    {label}
                    {sortBy === key && (
                      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M2 6.2 4.7 9 10 3.2" />
                      </svg>
                    )}
                  </button>
                ))}
          </PopoverMenu>
        </div>

        <div className="relative">
          <button
            type="button"
            data-timeline-options
            onClick={() => setMenu((m) => (m === "options" ? null : "options"))}
            className={menuButtonClass(optionsActive, menu === "options")}
            aria-expanded={menu === "options"}
            aria-haspopup="menu"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M3 4h10M3 8h10M3 12h10" />
              <circle cx="6" cy="4" r="1.4" fill="white" />
              <circle cx="10" cy="8" r="1.4" fill="white" />
              <circle cx="7" cy="12" r="1.4" fill="white" />
            </svg>
            オプション
            {optionsActive && <span className="h-1.5 w-1.5 rounded-full bg-[#2c60b8]" />}
          </button>
          <PopoverMenu
            open={menu === "options"}
            onClose={() => setMenu(null)}
            panelClassName="absolute right-0 top-8 z-30 w-56 rounded-lg border border-neutral-200 bg-white p-3 text-[13px] shadow-lg"
            panelProps={{ "data-timeline-options-menu": true }}
          >
                <label className="flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={showWeekends}
                    onChange={(e) => setShowWeekends(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  週末を網掛け
                </label>
                <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={showDependencies}
                    onChange={(e) => setShowDependencies(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  依存関係を表示
                </label>
                <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={showCritical}
                    onChange={(e) => setShowCritical(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  クリティカルパスを表示
                </label>
          </PopoverMenu>
        </div>
      </div>

  );
}
