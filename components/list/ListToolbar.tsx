"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Section, TaskTemplate, User } from "@/lib/data";
import TemplateBar from "../TemplateBar";

const menuLabel = "px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500";
const menuItem = "flex w-full items-center gap-1 rounded px-3 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100";
const toolbarBtn = "flex h-7 items-center rounded-md px-2 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100";
const clearPill = "px-1.5 text-[12px] hover:bg-[#dbe8fb]";
const popoverCls = "absolute top-full right-0 z-40 mt-1 w-64 rounded-lg border bg-white p-1.5 text-sm shadow-lg";
const checkItem = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100";
const menuSelect = "mt-1 w-full rounded-md border bg-white px-2 py-1 text-[13px] outline-none focus:border-blue-500";

export default function ListToolbar({
  projectId,
  sections,
  users,
  statusFieldEnabled,
  statusFieldName,
  statusOptions,
  focusAdd,
  toggleAddMenu,
  addMenu,
  addTemplates,
  instantiateTemplate,
  activeFilterCount,
  openFilterMenu,
  clearFilters,
  filterOpen,
  setFilterOpen,
  hideCompleted,
  setHideCompleted,
  pushState,
  assigneeFilter,
  setAssigneeFilter,
  dueFilter,
  setDueFilter,
  statusFilter,
  setStatusFilter,
  sortActive,
  openSortMenu,
  clearAllSort,
  sortOpen,
  setSortOpen,
  sortKey,
  setSortKey,
  sortDir,
  setSortDir,
  groupOpen,
  setGroupOpen,
  openGroupMenu,
  groupBy,
  setGroupBy,
  saving,
  setSaving,
  saveName,
  setSaveName,
  saveView,
  autoRefresh,
  setAutoRefresh,
  lastRefresh,
}: {
  projectId: number;
  sections: Section[];
  users: User[];
  statusFieldEnabled: boolean;
  statusFieldName: string;
  statusOptions: string[];
  focusAdd: () => void;
  toggleAddMenu: () => void;
  addMenu: boolean;
  addTemplates: TaskTemplate[];
  instantiateTemplate: (id: number) => void;
  activeFilterCount: number;
  openFilterMenu: () => void;
  clearFilters: () => void;
  filterOpen: boolean;
  setFilterOpen: Dispatch<SetStateAction<boolean>>;
  hideCompleted: boolean;
  setHideCompleted: (value: boolean) => void;
  pushState: (patch: {
    hide?: boolean;
    assignee?: string;
    status?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
    due?: string;
    group?: string;
  }) => void;
  assigneeFilter: string;
  setAssigneeFilter: (value: string) => void;
  dueFilter: string;
  setDueFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  sortActive: boolean;
  openSortMenu: () => void;
  clearAllSort: () => void;
  sortOpen: boolean;
  setSortOpen: Dispatch<SetStateAction<boolean>>;
  sortKey: "position" | "due" | "name" | "progress";
  setSortKey: (value: "position" | "due" | "name" | "progress") => void;
  sortDir: "asc" | "desc";
  setSortDir: (value: "asc" | "desc") => void;
  groupOpen: boolean;
  setGroupOpen: Dispatch<SetStateAction<boolean>>;
  openGroupMenu: () => void;
  groupBy: "section" | "assignee" | "status";
  setGroupBy: (value: "section" | "assignee" | "status") => void;
  saving: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  saveName: string;
  setSaveName: (value: string) => void;
  saveView: () => void;
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
  lastRefresh: string | null;
}) {
  return (
      <div className="flex flex-wrap items-center gap-1 border-b py-2 text-sm">
        <span className="relative flex">
          <button
            onClick={focusAdd}
            className="flex h-7 items-center gap-1 rounded-l-md border bg-white px-2.5 text-[12px] text-neutral-800 hover:bg-neutral-50"
          >
            <span className="text-[14px] leading-none text-neutral-500">＋</span> タスクを追加
          </button>
          <button
            onClick={toggleAddMenu}
            title="その他の追加方法"
            className="flex h-7 items-center rounded-r-md border border-l-0 bg-white px-1.5 text-neutral-600 hover:bg-neutral-50"
          >
            ▾
          </button>
          {addMenu && (
            <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-lg border bg-white py-1 text-sm shadow-lg">
              <div className={menuLabel}>テンプレートから作成</div>
              {addTemplates.length === 0 && (
                <div className="px-3 py-1 text-xs text-neutral-500">テンプレートなし</div>
              )}
              {addTemplates.map((t) => (
                <button key={t.id} className={menuItem} onClick={() => instantiateTemplate(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </span>
        <span className="ml-auto" />
        <span className="relative">
          {activeFilterCount > 0 ? (
            <span className="flex h-7 overflow-hidden rounded-md bg-[#eff4fd] text-[#2C60B8]">
              <button
                onClick={openFilterMenu}
                data-list-filter-open
                className="flex items-center pr-1 pl-2 text-[12px] font-medium hover:bg-[#e3edfc]"
              >
                絞り込み: {activeFilterCount}
              </button>
              <button title="絞り込みをクリア" onClick={clearFilters} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button onClick={openFilterMenu} data-list-filter-open className={toolbarBtn}>
              絞り込み
            </button>
          )}
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
              <div className={popoverCls}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-neutral-800">絞り込み</span>
                  {activeFilterCount > 0 && (
                    <button onClick={clearFilters} className="text-[12px] text-[#2C60B8] hover:underline">
                      クリア
                    </button>
                  )}
                </div>
                <label className={checkItem}>
                  <input
                    type="checkbox"
                    checked={hideCompleted}
                    data-list-hide-completed
                    onChange={(e) => {
                      setHideCompleted(e.target.checked);
                      pushState({ hide: e.target.checked });
                    }}
                  />
                  未完了のタスクのみ
                </label>
                <div className="mt-2 px-1.5 text-[11px] font-semibold tracking-wide text-neutral-500">担当者</div>
                <select
                  value={assigneeFilter}
                  data-list-assignee-select
                  onChange={(e) => {
                    setAssigneeFilter(e.target.value);
                    pushState({ assignee: e.target.value });
                  }}
                  className={menuSelect}
                >
                  <option value="">すべて</option>
                  <option value="none">未割当</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <div className="mt-2 px-1.5 text-[11px] font-semibold tracking-wide text-neutral-500">期日</div>
                <select
                  value={dueFilter}
                  onChange={(e) => {
                    setDueFilter(e.target.value);
                    pushState({ due: e.target.value });
                  }}
                  className={menuSelect}
                >
                  <option value="">すべて</option>
                  <option value="overdue">期限切れ</option>
                  <option value="today">今日</option>
                  <option value="week">今週</option>
                  <option value="nextweek">来週</option>
                  <option value="month">今月</option>
                </select>
                {statusFieldEnabled && (
                  <>
                    <div className="mt-2 px-1.5 text-[11px] font-semibold tracking-wide text-neutral-500">{statusFieldName}</div>
                    <select
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value);
                        pushState({ status: e.target.value });
                      }}
                      className={menuSelect}
                    >
                      <option value="">すべて</option>
                      {statusOptions.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </>
          )}
        </span>
        <span className="relative">
          {sortActive ? (
            <span className="flex h-7 overflow-hidden rounded-md bg-[#eff4fd] text-[#2C60B8]">
              <button
                onClick={openSortMenu}
                className="flex items-center pr-1 pl-2 text-[12px] font-medium hover:bg-[#e3edfc]"
              >
                ソート: 1
              </button>
              <button title="ソートをクリア" onClick={clearAllSort} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button onClick={openSortMenu} className={toolbarBtn}>
              ソート
            </button>
          )}
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className={popoverCls}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-neutral-800">並び替え</span>
                  {sortActive && (
                    <button onClick={clearAllSort} className="text-[12px] text-[#2C60B8] hover:underline">
                      クリア
                    </button>
                  )}
                </div>
                {[
                  ["position", "手動"],
                  ["due", "期日"],
                  ["name", "名前"],
                  ["progress", "進捗"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      if (key === "position") {
                        setSortKey("position");
                        setSortDir("asc");
                        pushState({ sort: "position" });
                      } else {
                        setSortKey(key as "name" | "due" | "progress");
                        setSortDir("asc");
                        pushState({ sort: key, sortdir: "asc" });
                      }
                      setSortOpen(false);
                    }}
                    className={checkItem}
                  >
                    <span className="w-4 text-[#2C60B8]">{sortKey === key ? "✓" : ""}</span>
                    {label}
                  </button>
                ))}
                {sortActive && (
                  <button
                    onClick={() => {
                      const next = sortDir === "asc" ? "desc" : "asc";
                      setSortDir(next);
                      pushState({ sortdir: next });
                    }}
                    className="mt-1 flex w-full items-center justify-between rounded-md border bg-white px-2 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
                  >
                    <span>{sortDir === "asc" ? "昇順" : "降順"}</span>
                    <span>{sortDir === "asc" ? "↑" : "↓"}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </span>
        <span className="relative">
          <button onClick={openGroupMenu} className={toolbarBtn}>
            グループ
          </button>
          {groupOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setGroupOpen(false)} />
              <div className={popoverCls}>
                <div className="mb-1 text-[13px] font-semibold text-neutral-800">グループ</div>
                {[
                  ["section", "セクション"],
                  ["assignee", "担当者"],
                  ...(statusFieldEnabled ? [["status", statusFieldName]] : []),
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setGroupBy(key as typeof groupBy);
                      pushState({ group: key });
                      setGroupOpen(false);
                    }}
                    className={checkItem}
                  >
                    <span className="w-4 text-[#2C60B8]">{groupBy === key ? "✓" : ""}</span>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
        <details className="relative">
          <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100 [&::-webkit-details-marker]:hidden">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 4h12M2 8h12M2 12h12" />
              <circle cx="6" cy="4" r="1.6" fill="white" />
              <circle cx="10" cy="8" r="1.6" fill="white" />
              <circle cx="5" cy="12" r="1.6" fill="white" />
            </svg>
            オプション
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border bg-white p-3 text-sm shadow-lg">
            {saving ? (
              <span className="flex items-center gap-1">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveView();
                  }}
                  placeholder="ビュー名"
                  aria-label="保存するビュー名"
                  autoFocus
                  className="w-32 rounded border px-2 py-0.5 text-sm outline-none focus:border-blue-500"
                />
                <button onClick={saveView} aria-label="ビューを保存" className="rounded bg-blue-600 px-2 py-0.5 text-sm text-white">
                  保存
                </button>
                <button onClick={() => setSaving(false)} aria-label="ビュー保存をキャンセル" className="text-sm text-neutral-500">
                  ×
                </button>
              </span>
            ) : (
              <button onClick={() => setSaving(true)} aria-label="現在のビューを保存" className="text-sm text-neutral-600 hover:text-black">
                ビューを保存
              </button>
            )}
            <label className="mt-2 flex items-center gap-1 text-neutral-600" title="20秒ごとに自動更新（表示中のみ）">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              自動更新{lastRefresh ? `（${lastRefresh}）` : ""}
            </label>
            <TemplateBar projectId={projectId} sections={sections} users={users} />
          </div>
        </details>
      </div>
  );
}
