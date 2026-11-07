"use client";

import { useState } from "react";
import type { User } from "@/lib/data";
import {
  LIST_DATE_FILTER_OPTIONS,
  type ListFilters,
} from "@/lib/list-view";

type FieldKey = "assignee" | "due" | "start" | "creator" | "created" | "updated" | "completed_on" | "status";

const FIELD_LABELS: Record<FieldKey, string> = {
  assignee: "担当者",
  due: "期日",
  start: "開始日",
  creator: "作成したユーザー",
  created: "作成日",
  updated: "最終変更日",
  completed_on: "完了日",
  status: "Status",
};

const FIELD_ORDER: FieldKey[] = [
  "assignee",
  "due",
  "start",
  "creator",
  "created",
  "updated",
  "completed_on",
  "status",
];

const quickFilterCls =
  "flex h-7 items-center rounded-full border px-2.5 text-[12px] transition-colors";
const rowSelect =
  "h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]";

function initialFields(filters: ListFilters, statusEnabled: boolean): FieldKey[] {
  return FIELD_ORDER.filter((key) => {
    if (key === "status" && !statusEnabled) return false;
    if (key === "assignee") return filters.assignee !== "";
    if (key === "creator") return filters.creator !== "";
    if (key === "due") return filters.due !== "";
    return filters[key] !== "";
  });
}

function dateSelect(
  value: string,
  onChange: (value: string) => void,
  dataAttr: string,
) {
  return (
    <select
      value={value}
      data-list-filter-input={dataAttr}
      onChange={(event) => onChange(event.target.value)}
      className={rowSelect}
    >
      <option value="">すべて</option>
      {LIST_DATE_FILTER_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Asana-style filter popover: quick filters + addable field filters. */
export default function ListFilterMenu({
  filters,
  activeCount,
  users,
  statusFieldEnabled,
  statusFieldName,
  statusOptions,
  onChange,
  onClear,
}: {
  filters: ListFilters;
  activeCount: number;
  users: User[];
  statusFieldEnabled: boolean;
  statusFieldName: string;
  statusOptions: string[];
  onChange: (key: keyof ListFilters, value: string | boolean) => void;
  onClear: () => void;
}) {
  const [fields, setFields] = useState<FieldKey[]>(() => initialFields(filters, statusFieldEnabled));
  const [addOpen, setAddOpen] = useState(false);

  const removeField = (key: FieldKey) => {
    setFields((current) => current.filter((item) => item !== key));
    if (key === "assignee" || key === "creator" || key === "due" || key === "status") onChange(key, "");
    else onChange(key, "");
  };

  const addField = (key: FieldKey) => {
    setFields((current) => (current.includes(key) ? current : [...current, key]));
    setAddOpen(false);
  };

  const available = FIELD_ORDER.filter(
    (key) => !fields.includes(key) && (key !== "status" || statusFieldEnabled),
  );

  const quick = (key: string, label: string, active: boolean, onClick: () => void, extra?: string) => (
    <button
      key={key}
      type="button"
      data-list-quick-filter={key}
      aria-pressed={active}
      onClick={onClick}
      className={`${quickFilterCls} ${
        active
          ? "border-[#2c60b8] bg-[#eff4fd] text-[#2c60b8]"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {label}
      {extra && <span className="ml-1 text-[11px] text-neutral-400">{extra}</span>}
    </button>
  );

  const row = (key: FieldKey) => {
    let control: React.ReactNode = null;
    if (key === "assignee") {
      control = (
        <select
          value={filters.assignee}
          data-list-filter-input="assignee"
          onChange={(event) => onChange("assignee", event.target.value)}
          className={rowSelect}
        >
          <option value="">すべて</option>
          <option value="none">未割当</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      );
    } else if (key === "creator") {
      control = (
        <select
          value={filters.creator}
          data-list-filter-input="creator"
          onChange={(event) => onChange("creator", event.target.value)}
          className={rowSelect}
        >
          <option value="">すべて</option>
          <option value="none">作成者なし</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      );
    } else if (key === "due") {
      control = (
        <select
          value={filters.due}
          data-list-filter-input="due"
          onChange={(event) => onChange("due", event.target.value)}
          className={rowSelect}
        >
          <option value="">すべて</option>
          <option value="overdue">期限切れ</option>
          <option value="today">今日</option>
          <option value="week">今週</option>
          <option value="nextweek">来週</option>
          <option value="month">今月</option>
        </select>
      );
    } else if (key === "status") {
      control = (
        <select
          value={filters.status}
          data-list-filter-input="status"
          onChange={(event) => onChange("status", event.target.value)}
          className={rowSelect}
        >
          <option value="">すべて</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      );
    } else {
      control = dateSelect(filters[key], (value) => onChange(key, value), key);
    }
    return (
      <div key={key} data-list-filter-row={key} className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-[12px] text-neutral-600">
          {key === "status" ? statusFieldName : FIELD_LABELS[key]}
        </span>
        {control}
        <button
          type="button"
          aria-label={`${FIELD_LABELS[key]}フィルターを削除`}
          onClick={() => removeField(key)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ×
        </button>
      </div>
    );
  };

  return (
    <div data-list-filter-menu className="max-h-[70vh] overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-neutral-800">
          フィルター{activeCount > 0 ? `: ${activeCount}` : ""}
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={activeCount === 0}
          className="text-[12px] text-[#2c60b8] hover:underline disabled:text-neutral-300 disabled:no-underline"
        >
          クリア
        </button>
      </div>

      <div className="mt-3 text-[11px] font-medium text-neutral-500">クイックフィルター</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {quick(
          "open",
          "未完了タスク",
          filters.hide_completed && !filters.completed_only,
          () => {
            const next = !(filters.hide_completed && !filters.completed_only);
            onChange("hide_completed", next);
            if (next) onChange("completed_only", false);
          },
        )}
        {quick(
          "done",
          "完了したタスク",
          filters.completed_only,
          () => {
            const next = !filters.completed_only;
            onChange("completed_only", next);
            if (next) onChange("hide_completed", false);
          },
        )}
        {quick("mine", "自分のタスクのみ", filters.mine_only, () => onChange("mine_only", !filters.mine_only))}
        {quick("week", "今週期限", filters.due === "week", () => onChange("due", filters.due === "week" ? "" : "week"))}
        {quick("nextweek", "来週期限", filters.due === "nextweek", () => onChange("due", filters.due === "nextweek" ? "" : "nextweek"))}
      </div>

      {fields.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-neutral-100 pt-3">
          {fields.map(row)}
        </div>
      )}

      <div className="relative mt-3 border-t border-neutral-100 pt-2">
        <button
          type="button"
          data-list-filter-add
          aria-expanded={addOpen}
          onClick={() => setAddOpen((open) => !open)}
          className="flex h-7 items-center gap-1 rounded px-1.5 text-[12px] text-neutral-600 hover:bg-neutral-100"
        >
          <span className="text-[14px] leading-none">＋</span>
          フィルターを追加
        </button>
        {addOpen && (
          <div data-list-filter-add-menu className="mt-1 rounded-md border border-neutral-200 bg-white py-1">
            {available.length === 0 && (
              <div className="px-3 py-1 text-[12px] text-neutral-400">追加できるフィルターはありません</div>
            )}
            {available.map((key) => (
              <button
                key={key}
                type="button"
                data-list-filter-add-option={key}
                onClick={() => addField(key)}
                className="flex h-8 w-full items-center px-3 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
              >
                {key === "status" ? statusFieldName : FIELD_LABELS[key]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
