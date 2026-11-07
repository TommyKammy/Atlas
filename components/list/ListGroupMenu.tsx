"use client";

import { useState } from "react";
import type { CustomField } from "@/lib/data";
import {
  LIST_GROUP_LABELS,
  LIST_GROUP_OPTIONS,
  type ListGroupBy,
} from "@/lib/list-view";

function groupLabel(key: ListGroupBy, customFields: CustomField[], statusFieldName: string): string {
  if (key === "status") return statusFieldName || "Status";
  if (key.startsWith("cf-")) {
    const id = Number(key.slice(3));
    return customFields.find((field) => field.id === id)?.name ?? "カスタムフィールド";
  }
  return LIST_GROUP_LABELS[key] ?? key;
}

/** Asana-style group panel: primary field, custom sort and optional subgroup. */
export default function ListGroupMenu({
  groupBy,
  group2,
  groupDir,
  customFields,
  statusFieldEnabled,
  statusFieldName,
  allowSubgroup = true,
  onSelectPrimary,
  onSelectSecondary,
  onClearSecondary,
  onSetGroupDir,
  onClear,
}: {
  groupBy: ListGroupBy;
  group2: ListGroupBy | null;
  groupDir: "asc" | "desc";
  customFields: CustomField[];
  statusFieldEnabled: boolean;
  statusFieldName: string;
  allowSubgroup?: boolean;
  onSelectPrimary: (key: ListGroupBy) => void;
  onSelectSecondary: (key: ListGroupBy | null) => void;
  onClearSecondary: () => void;
  onSetGroupDir: (dir: "asc" | "desc") => void;
  onClear: () => void;
}) {
  const [showSecondary, setShowSecondary] = useState(group2 !== null);
  const primaryOptions: ListGroupBy[] = [
    "section",
    ...LIST_GROUP_OPTIONS.filter((key) => key !== "status" || statusFieldEnabled),
    ...customFields.map((field) => `cf-${field.id}` as ListGroupBy),
  ];
  const secondaryOptions = primaryOptions.filter((key) => key !== groupBy);

  return (
    <div data-list-group-menu className="p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-neutral-800">グループ</span>
        <button
          type="button"
          onClick={onClear}
          disabled={groupBy === "section" && group2 === null}
          className="text-[12px] text-[#2c60b8] hover:underline disabled:text-neutral-300 disabled:no-underline"
        >
          クリア
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="w-24 shrink-0 text-[12px] text-neutral-600">グループ</span>
        <select
          data-list-group-primary
          value={groupBy}
          onChange={(event) => onSelectPrimary(event.target.value as ListGroupBy)}
          className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
        >
          {primaryOptions.map((key) => (
            <option key={key} value={key}>
              {groupLabel(key, customFields, statusFieldName)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="w-24 shrink-0 text-[12px] text-neutral-600">カスタムソート</span>
        <select
          data-list-group-dir
          value={groupDir}
          onChange={(event) => onSetGroupDir(event.target.value === "desc" ? "desc" : "asc")}
          className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
        >
          <option value="asc">昇順</option>
          <option value="desc">降順</option>
        </select>
      </div>

      {allowSubgroup && (group2 === null ? (
        showSecondary ? (
          <div className="mt-2 flex items-center gap-2">
            <span className="w-24 shrink-0 text-[12px] text-neutral-600">サブグループ</span>
            <select
              data-list-group-secondary
              defaultValue=""
              onChange={(event) => {
                if (event.target.value === "") return;
                onSelectSecondary(event.target.value as ListGroupBy);
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
            >
              <option value="">選択…</option>
              {secondaryOptions.map((key) => (
                <option key={key} value={key}>
                  {groupLabel(key, customFields, statusFieldName)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <button
            type="button"
            data-list-group-add-subgroup
            onClick={() => setShowSecondary(true)}
            className="mt-2 flex h-7 items-center gap-1 rounded px-1.5 text-[12px] text-neutral-600 hover:bg-neutral-100"
          >
            <span className="text-[14px] leading-none">＋</span>
            サブグループを追加
          </button>
        )
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <span className="w-24 shrink-0 text-[12px] text-neutral-600">サブグループ</span>
          <select
            data-list-group-secondary
            value={group2}
            onChange={(event) => onSelectSecondary(event.target.value === "" ? null : (event.target.value as ListGroupBy))}
            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
          >
            <option value="">なし</option>
            {secondaryOptions.map((key) => (
              <option key={key} value={key}>
                {groupLabel(key, customFields, statusFieldName)}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="サブグループを削除"
            onClick={() => {
              onClearSecondary();
              setShowSecondary(false);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ×
          </button>
        </div>
      ))}

      <div className="mt-3 border-t border-neutral-100 px-1 pt-2">
        <a href="/help" className="text-[12px] text-[#6d5bd0] hover:underline">
          フィードバックを送る
        </a>
      </div>
    </div>
  );
}
