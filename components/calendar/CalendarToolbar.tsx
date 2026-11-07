"use client";

import Link from "next/link";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { TaskRow, User } from "@/lib/data";
import type { CustomField } from "@/lib/custom-fields";

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
  optionsActive,
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
  optionsActive: boolean;
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
}) {
  return (
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
              undated.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    dragging.current = true;
                    e.dataTransfer.setData("text/atlas-task", String(t.id));
                  }}
                  onDragEnd={() => {
                    setTimeout(() => {
                      dragging.current = false;
                    }, 0);
                  }}
                  onClick={() => {
                    if (dragging.current) return;
                    openTask(t.id);
                  }}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
                  title="日付を設定するにはカレンダーへドラッグ"
                >
                  {t.name}
                </button>
              ))
            )}
          </div>
        </details>
        <details className="relative">
          <summary
            data-calendar-zoom
            className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[13px] text-neutral-700 hover:bg-neutral-100 [&::-webkit-details-marker]:hidden"
          >
            {weekMode ? "週" : "月"}
            <span className="text-[10px] text-neutral-400">▾</span>
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-40 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
            <Link href={weekHref} className="flex h-9 items-center gap-2 rounded px-2 text-[13px] hover:bg-neutral-100">
              <span className="w-3 text-neutral-700">{weekMode ? "✓" : ""}</span>週
            </Link>
            <Link href={monthHref} className="flex h-9 items-center gap-2 rounded px-2 text-[13px] hover:bg-neutral-100">
              <span className="w-3 text-neutral-700">{!weekMode ? "✓" : ""}</span>月
            </Link>
          </div>
        </details>
        <details className="relative">
          <summary
            data-calendar-filter
            className={`flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[13px] hover:bg-neutral-100 [&::-webkit-details-marker]:hidden ${
              activeFilters ? "bg-[#eff4fd] font-medium text-[#2c60b8]" : "text-neutral-700"
            }`}
          >
            フィルター
            {activeFilters > 0 && <span className="text-[11px]">{activeFilters}</span>}
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-[min(420px,calc(100vw-2rem))] rounded-lg border border-neutral-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
              <span className="text-[13px] font-medium">フィルター</span>
              <button
                type="button"
                data-calendar-clear
                onClick={clearFilters}
                className="text-xs text-[#2c60b8] hover:underline"
              >
                クリア
              </button>
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-3">
              <div className="text-[11px] font-medium text-neutral-500">クイックフィルター</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  data-calendar-quick-completed="open"
                  onClick={() => setCompleted("open")}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    completedFilter === "open"
                      ? "border-[#b8ccef] bg-[#eff4fd] text-[#2c60b8]"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  未完了タスク
                </button>
                <button
                  type="button"
                  data-calendar-quick-completed="done"
                  onClick={() => setCompleted("done")}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    completedFilter === "done"
                      ? "border-[#b8ccef] bg-[#eff4fd] text-[#2c60b8]"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  完了したタスク
                </button>
                {viewerId !== null && (
                  <button
                    type="button"
                    data-calendar-quick-mine
                    onClick={() => setAssignee(assigneeFilter === String(viewerId) ? "" : String(viewerId))}
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      assigneeFilter === String(viewerId)
                        ? "border-[#b8ccef] bg-[#eff4fd] text-[#2c60b8]"
                        : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    自分のタスクのみ
                  </button>
                )}
              </div>
              <div className="mt-3 border-t border-neutral-100 pt-2">
                <div className="text-[11px] font-medium text-neutral-500">フィルターを追加</div>
                <label className="mt-1 block text-xs text-neutral-500">
                  担当者
                  <select
                    data-calendar-filter-assignee
                    value={assigneeFilter}
                    onChange={(e) => setAssignee(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="none">未割当</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                {statusFieldEnabled && (
                  <label className="mt-2 block text-xs text-neutral-500">
                    {statusFieldName}
                    <select
                      data-calendar-filter-status
                      value={statusFilter}
                      onChange={(e) => setStatus(e.target.value)}
                      className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                    >
                      <option value="">すべて</option>
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="mt-2 block text-xs text-neutral-500">
                  期日
                  <select
                    data-calendar-filter-due
                    value={dueFilter}
                    onChange={(e) => setDue(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="overdue">期限切れ</option>
                    <option value="today">今日</option>
                    <option value="week">今週</option>
                    <option value="nextweek">来週</option>
                    <option value="month">来月まで</option>
                    <option value="none">日付なし</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  作成日
                  <select
                    data-calendar-filter-created
                    value={createdFilter}
                    onChange={(e) => setCreated(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="today">今日</option>
                    <option value="7">過去7日</option>
                    <option value="30">過去30日</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  最終変更日
                  <select
                    data-calendar-filter-updated
                    value={updatedFilter}
                    onChange={(e) => setUpdated(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="today">今日</option>
                    <option value="7">過去7日</option>
                    <option value="30">過去30日</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  完了日
                  <select
                    data-calendar-filter-completed-on
                    value={completedOnFilter}
                    onChange={(e) => setCompletedOn(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="today">今日</option>
                    <option value="7">過去7日</option>
                    <option value="30">過去30日</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  作成したユーザー
                  <select
                    data-calendar-filter-creator
                    value={creatorFilter}
                    onChange={(e) => setCreator(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="none">未設定</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectFields.map((field) => (
                  <label key={field.id} className="mt-2 block text-xs text-neutral-500">
                    {field.name}
                    <select
                      data-calendar-filter-field={field.id}
                      value={customFilter[String(field.id)] ?? ""}
                      onChange={(e) => setCustomFilterValue(field.id, e.target.value)}
                      className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                    >
                      <option value="">すべて</option>
                      {customFilter[String(field.id)] &&
                        !field.options.includes(customFilter[String(field.id)]) && (
                          <option value={customFilter[String(field.id)]}>{customFilter[String(field.id)]}</option>
                        )}
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </details>
        <details className="relative">
          <summary
            data-calendar-options
            className={`flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[13px] hover:bg-neutral-100 [&::-webkit-details-marker]:hidden ${
              optionsActive ? "bg-[#eff4fd] font-medium text-[#2c60b8]" : "text-neutral-700"
            }`}
          >
            オプション
            <span className="text-[10px] text-neutral-400">▾</span>
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
            <div className="text-[11px] font-medium text-neutral-500">レイアウトオプション</div>
            <label className="mt-2 block text-xs text-neutral-500">
              タスクのカラー
              <select
                data-calendar-color
                value={colorBy}
                onChange={(e) => setColor(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
              >
                {colorOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                data-calendar-weekends
                checked={showWeekends}
                onChange={(e) => setWeekends(e.target.checked)}
              />
              週末を表示
            </label>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                data-calendar-multi
                checked={showMulti}
                onChange={(e) => setMulti(e.target.checked)}
              />
              複数日にわたるタスクを表示
            </label>
            <label className="mt-3 block text-xs text-neutral-500">
              週の始まり
              <select
                data-calendar-week-start
                value={weekStart}
                onChange={(e) => setWeekStartOn(e.target.value === "1" ? 1 : 0)}
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
              >
                <option value={0}>日曜日</option>
                <option value={1}>月曜日</option>
              </select>
            </label>
          </div>
        </details>
        {searchOpen && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
            setSearchOpen((v) => !v);
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
  );
}
