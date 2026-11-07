"use client";

import Link from "next/link";
import { useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { toast } from "@/lib/ui-feedback";
import type { TaskRow, User } from "@/lib/data";
import type { CustomField } from "@/lib/custom-fields";
import { parseListDateFilter, type ListFilters } from "@/lib/list-view";
import ListFilterMenu from "../list/ListFilterMenu";
import ViewOptionsDrawer from "../view/ViewOptionsDrawer";
import { FilterIcon, OptionsIcon } from "../view/ViewToolbarIcons";

const toolbarBtn =
  "flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700";
const activePill = "flex h-7 overflow-hidden rounded-md bg-[#eff4fd] text-[#2C60B8]";
const activePillMain = "flex items-center gap-1 pr-1 pl-2 text-[12px] font-medium hover:bg-[#e3edfc]";
const clearPill = "px-1.5 text-[12px] hover:bg-[#dbe8fb]";
const popoverBase = "absolute top-full z-40 mt-1 rounded-lg border border-neutral-200 bg-white shadow-lg";

export default function CalendarToolbar({
  addToday,
  prevHref,
  todayHref,
  nextHref,
  weekMode,
  title,
  undated,
  dragging,
  openTask,
  weekHref,
  monthHref,
  activeFilters,
  clearFilters,
  completedFilter,
  setCompleted,
  viewerId,
  assigneeFilter,
  setAssignee,
  users,
  statusFieldEnabled,
  statusFieldName,
  statusOptions,
  statusFilter,
  setStatus,
  dueFilter,
  setDue,
  createdFilter,
  setCreated,
  updatedFilter,
  setUpdated,
  completedOnFilter,
  setCompletedOn,
  creatorFilter,
  setCreator,
  selectFields,
  customFilter,
  setCustomFilterValue,
  colorBy,
  setColor,
  colorOptions,
  showWeekends,
  setWeekends,
  showMulti,
  setMulti,
  weekStart,
  setWeekStartOn,
  searchOpen,
  search,
  setSearch,
  setSearchOpen,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
}: {
  addToday: () => void;
  prevHref: string;
  todayHref: string;
  nextHref: string;
  weekMode: boolean;
  title: string;
  undated: TaskRow[];
  dragging: MutableRefObject<boolean>;
  openTask: (id: number) => void;
  weekHref: string;
  monthHref: string;
  activeFilters: number;
  clearFilters: () => void;
  completedFilter: "open" | "done" | "";
  setCompleted: (value: "open" | "done" | "") => void;
  viewerId: number | null;
  assigneeFilter: string;
  setAssignee: (value: string) => void;
  users: User[];
  statusFieldEnabled: boolean;
  statusFieldName: string;
  statusOptions: string[];
  statusFilter: string;
  setStatus: (value: string) => void;
  dueFilter: string;
  setDue: (value: string) => void;
  createdFilter: string;
  setCreated: (value: string) => void;
  updatedFilter: string;
  setUpdated: (value: string) => void;
  completedOnFilter: string;
  setCompletedOn: (value: string) => void;
  creatorFilter: string;
  setCreator: (value: string) => void;
  selectFields: CustomField[];
  customFilter: Record<string, string>;
  setCustomFilterValue: (fieldId: number, value: string) => void;
  colorBy: string;
  setColor: (value: string) => void;
  colorOptions: { value: string; label: string }[];
  showWeekends: boolean;
  setWeekends: (value: boolean) => void;
  showMulti: boolean;
  setMulti: (value: boolean) => void;
  weekStart: 0 | 1;
  setWeekStartOn: (value: 0 | 1) => void;
  searchOpen: boolean;
  search: string;
  setSearch: (value: string) => void;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [filterOpen, setFilterOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  useEffect(() => {
    if (!filterOpen && !optionsOpen && !zoomOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFilterOpen(false);
      setOptionsOpen(false);
      setZoomOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, optionsOpen, zoomOpen]);

  const filters: ListFilters = {
    hide_completed: completedFilter === "open",
    completed_only: completedFilter === "done",
    mine_only: viewerId !== null && assigneeFilter === String(viewerId),
    assignee: assigneeFilter,
    status: statusFilter,
    due: dueFilter,
    start: "",
    creator: creatorFilter,
    created: parseListDateFilter(createdFilter),
    updated: parseListDateFilter(updatedFilter),
    completed_on: parseListDateFilter(completedOnFilter),
  };

  const onFilterChange = (key: keyof ListFilters, value: string | boolean) => {
    if (key === "hide_completed") setCompleted(value === true ? "open" : "");
    else if (key === "completed_only") setCompleted(value === true ? "done" : "");
    else if (key === "mine_only") setAssignee(value === true && viewerId !== null ? String(viewerId) : "");
    else if (key === "assignee") setAssignee(String(value));
    else if (key === "status") setStatus(String(value));
    else if (key === "due") setDue(String(value));
    else if (key === "creator") setCreator(String(value));
    else if (key === "created") setCreated(String(value));
    else if (key === "updated") setUpdated(String(value));
    else if (key === "completed_on") setCompletedOn(String(value));
  };

  const renameView = async (name: string) => {
    if (!canEdit || viewTabId === null) return;
    try {
      await api(`/api/project-tabs/${viewTabId}`, "PATCH", { name });
      toast("ビュー名を変更しました");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "ビュー名を変更できませんでした");
    }
  };

  const updateViewIcon = async (icon: string | null) => {
    if (!canEdit || viewTabId === null) return;
    try {
      await api(`/api/project-tabs/${viewTabId}`, "PATCH", { icon });
      toast("ビューのアイコンを変更しました");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "アイコンを変更できませんでした");
    }
  };

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 py-2">
        <button
          type="button"
          onClick={addToday}
          data-calendar-add
          className="mr-1 flex h-7 items-center rounded-md border border-[#e1e1e1] bg-white px-2.5 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50"
        >
          ＋ タスクを追加
        </button>
        <Link
          href={prevHref}
          aria-label={weekMode ? "前週" : "前月"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100"
        >
          ‹
        </Link>
        <Link href={todayHref} className="flex h-7 items-center rounded-md px-2 text-[13px] text-neutral-700 hover:bg-neutral-100">
          今日
        </Link>
        <Link
          href={nextHref}
          aria-label={weekMode ? "来週" : "来月"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100"
        >
          ›
        </Link>
        <span className="ml-1 text-[15px] font-medium text-neutral-900">{title}</span>

        <span className="ml-auto" />
        <details className="relative">
          <summary
            data-calendar-undated
            className={`flex h-7 cursor-pointer list-none items-center rounded-md px-2 text-[13px] hover:bg-neutral-100 [&::-webkit-details-marker]:hidden ${
              undated.length ? "text-neutral-700" : "text-neutral-400"
            }`}
          >
            日付なしのタスク ({undated.length} 件)
          </summary>
          <div className="absolute right-0 z-30 mt-1 max-h-64 w-72 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
            {undated.length === 0 ? (
              <div className="px-2 py-2 text-xs text-neutral-400">日付なしのタスクはありません</div>
            ) : (
              undated.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    dragging.current = true;
                    event.dataTransfer.setData("text/atlas-task", String(task.id));
                  }}
                  onDragEnd={() => {
                    setTimeout(() => {
                      dragging.current = false;
                    }, 0);
                  }}
                  onClick={() => {
                    if (dragging.current) return;
                    openTask(task.id);
                  }}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
                  title="日付を設定するにはカレンダーへドラッグ"
                >
                  {task.name}
                </button>
              ))
            )}
          </div>
        </details>

        <span className="relative">
          <button
            type="button"
            data-calendar-zoom
            aria-haspopup="menu"
            aria-expanded={zoomOpen}
            onClick={() => setZoomOpen((value) => !value)}
            className={toolbarBtn}
          >
            {weekMode ? "週" : "月"}
            <span className="text-[10px] text-neutral-400">▾</span>
          </button>
          {zoomOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setZoomOpen(false)} />
              <div className="absolute top-full right-0 z-40 mt-1 w-40 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
                <Link href={weekHref} onClick={() => setZoomOpen(false)} className="flex h-9 items-center gap-2 rounded px-2 text-[13px] hover:bg-neutral-100">
                  <span className="w-3 text-neutral-700">{weekMode ? "✓" : ""}</span>週
                </Link>
                <Link href={monthHref} onClick={() => setZoomOpen(false)} className="flex h-9 items-center gap-2 rounded px-2 text-[13px] hover:bg-neutral-100">
                  <span className="w-3 text-neutral-700">{!weekMode ? "✓" : ""}</span>月
                </Link>
              </div>
            </>
          )}
        </span>

        <span className="relative">
          {activeFilters > 0 ? (
            <span className={activePill}>
              <button
                type="button"
                data-calendar-filter
                data-calendar-filter-open
                aria-expanded={filterOpen}
                aria-haspopup="menu"
                onClick={() => setFilterOpen((value) => !value)}
                className={activePillMain}
              >
                <FilterIcon /> フィルター: {activeFilters}
              </button>
              <button type="button" title="フィルターをクリア" onClick={clearFilters} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-calendar-filter
              data-calendar-filter-open
              aria-expanded={filterOpen}
              aria-haspopup="menu"
              onClick={() => setFilterOpen((value) => !value)}
              className={toolbarBtn}
            >
              <FilterIcon /> フィルター
            </button>
          )}
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
              <div className={`${popoverBase} right-0 w-[560px] max-w-[calc(100vw-2rem)]`}>
                <ListFilterMenu
                  filters={filters}
                  activeCount={activeFilters}
                  users={users}
                  statusFieldEnabled={statusFieldEnabled}
                  statusFieldName={statusFieldName}
                  statusOptions={statusOptions}
                  quickFilters={["open", "done", "mine"]}
                  allowedBuiltins={["assignee", "due", "creator", "created", "updated", "completed_on", "status"]}
                  customFields={selectFields}
                  customFilter={customFilter}
                  onChange={onFilterChange}
                  onCustomFilterChange={setCustomFilterValue}
                  onClear={clearFilters}
                />
              </div>
            </>
          )}
        </span>

        <button
          type="button"
          data-calendar-options
          data-calendar-options-open
          aria-haspopup="dialog"
          aria-expanded={optionsOpen}
          onClick={() => {
            setFilterOpen(false);
            setOptionsOpen(true);
          }}
          className={toolbarBtn}
        >
          <OptionsIcon /> オプション
        </button>
        {searchOpen && (
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="このビュー内で検索"
            aria-label="このビュー内で検索"
            autoFocus
            className="h-7 w-44 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#4075cf]"
          />
        )}
        <button
          type="button"
          onClick={() => {
            if (searchOpen) setSearch("");
            setSearchOpen((value) => !value);
          }}
          data-calendar-search
          aria-label="このビューで検索"
          title="このビュー内で検索"
          className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-100 ${
            searchOpen ? "bg-[#eff4fd] text-[#2c60b8]" : "text-neutral-500"
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="6.8" cy="6.8" r="4.3" />
            <path d="m10.1 10.1 3 3" />
          </svg>
        </button>
      </div>

      <ViewOptionsDrawer
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="カレンダー"
        viewName={viewName}
        viewIcon={viewIcon}
        viewTabId={viewTabId}
        canEdit={canEdit}
        onRenameView={renameView}
        onUpdateIcon={updateViewIcon}
        filterSummary={activeFilters > 0 ? `適用中: ${activeFilters}` : "なし"}
        sortSummary=""
        showSort={false}
        onOpenFilter={() => {
          setOptionsOpen(false);
          setFilterOpen(true);
        }}
        onOpenSort={() => undefined}
      >
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <div className="px-2 text-[11px] font-medium text-neutral-500">レイアウトオプション</div>
          <label className="mt-2 block px-2 text-[12px] text-neutral-600">
            タスクのカラー
            <select
              value={colorBy}
              onChange={(event) => setColor(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
            >
              {colorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-neutral-700 hover:bg-neutral-50">
            <input type="checkbox" checked={showWeekends} onChange={(event) => setWeekends(event.target.checked)} className="h-3.5 w-3.5 accent-[#2c60b8]" />
            週末を表示
          </label>
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-neutral-700 hover:bg-neutral-50">
            <input type="checkbox" checked={showMulti} onChange={(event) => setMulti(event.target.checked)} className="h-3.5 w-3.5 accent-[#2c60b8]" />
            複数日にわたるタスクを表示
          </label>
          <label className="mt-1 block px-2 text-[12px] text-neutral-600">
            週の始まり
            <select
              value={weekStart}
              onChange={(event) => setWeekStartOn(event.target.value === "1" ? 1 : 0)}
              className="mt-1 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
            >
              <option value={0}>日曜日</option>
              <option value={1}>月曜日</option>
            </select>
          </label>
        </div>
        <div className="mt-2 border-t border-neutral-100 pt-3">
          <div className="px-2 text-[11px] font-medium text-neutral-500">ズーム</div>
          <div className="mt-1 flex gap-1 px-2">
            <Link
              href={weekHref}
              onClick={() => setOptionsOpen(false)}
              className={`flex h-8 flex-1 items-center justify-center rounded-md border text-[13px] ${
                weekMode ? "border-[#2c60b8] bg-[#eff4fd] text-[#2c60b8]" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              週
            </Link>
            <Link
              href={monthHref}
              onClick={() => setOptionsOpen(false)}
              className={`flex h-8 flex-1 items-center justify-center rounded-md border text-[13px] ${
                !weekMode ? "border-[#2c60b8] bg-[#eff4fd] text-[#2c60b8]" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              月
            </Link>
          </div>
        </div>
      </ViewOptionsDrawer>
    </>
  );
}
