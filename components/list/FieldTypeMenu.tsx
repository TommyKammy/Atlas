"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CustomField, CustomFieldType } from "@/lib/custom-fields";

export type FieldLibraryEntry = {
  id: number;
  name: string;
  field_type: CustomFieldType;
  options: string[];
  description: string;
  config?: CustomField["config"];
};

export type FieldTypeChoice = {
  type: CustomFieldType;
  label: string;
  description: string;
  icon: string;
};

const PRIMARY_TYPES: FieldTypeChoice[] = [
  { type: "select", label: "単一選択", description: "1つの選択肢を選ぶ", icon: "◉" },
  { type: "multi_select", label: "複数選択", description: "複数の選択肢を選ぶ", icon: "☑" },
  { type: "date", label: "日付", description: "日付を入力する", icon: "📅" },
  { type: "people", label: "メンバー", description: "プロジェクトメンバーを選択", icon: "👤" },
  { type: "reference", label: "リファレンス", description: "他のプロジェクトのタスクを紐づける", icon: "🔗" },
  { type: "lookup", label: "ルックアップ", description: "参照先のフィールド値を表示", icon: "⇢" },
  { type: "text", label: "テキスト", description: "自由入力の短いテキスト", icon: "T" },
  { type: "number", label: "数値", description: "金額・数量・集計に使う", icon: "#" },
  { type: "formula", label: "数式", description: "数値フィールドから計算する", icon: "ƒ" },
  { type: "rollup", label: "集計", description: "サブタスクや参照先を集計", icon: "Σ" },
  { type: "auto_id", label: "ID", description: "連番のIDを自動採番", icon: "ID" },
  { type: "timer", label: "タイマー", description: "作業時間を計測する", icon: "⏱" },
  { type: "time_tracking", label: "タイムトラッキング", description: "タイマーの合計時間を表示", icon: "◷" },
];

const MORE_TYPES: FieldTypeChoice[] = [
  { type: "project", label: "プロジェクト", description: "所属プロジェクトを表示", icon: "▤" },
  { type: "blocked_by", label: "先行タスク", description: "先行タスク数を表示", icon: "←" },
  { type: "blocking", label: "後続を待たせている", description: "後続タスク数を表示", icon: "→" },
  { type: "completed_on", label: "完了日", description: "完了した日を表示", icon: "✓" },
  { type: "modified_at", label: "最終変更日", description: "最終更新日を表示", icon: "↻" },
  { type: "created_at", label: "作成日", description: "作成日を表示", icon: "＋" },
  { type: "created_by", label: "作成したユーザー", description: "作成者を表示", icon: "✎" },
  { type: "collaborators", label: "コラボレーター", description: "タスクの関係者を表示", icon: "👥" },
  { type: "attachments", label: "添付", description: "添付ファイル数を表示", icon: "📎" },
];

/** Asana-style listbox anchored to the trailing "+" field header. */
export default function FieldTypeMenu({
  projectId,
  anchor,
  onPick,
  onClose,
  onRestored,
  onPickTemplate,
}: {
  projectId: number;
  anchor: { left: number; right: number; top: number; bottom: number };
  onPick: (type: CustomFieldType) => void;
  onClose: () => void;
  onRestored: () => void;
  onPickTemplate: (entry: FieldLibraryEntry) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [deleted, setDeleted] = useState<{ id: number; name: string; field_type: string }[] | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [library, setLibrary] = useState<FieldLibraryEntry[] | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [removingLibrary, setRemovingLibrary] = useState<number | null>(null);

  const loadLibrary = async () => {
    if (library) {
      setLibrary(null);
      return;
    }
    setLibraryLoading(true);
    try {
      const res = await fetch(`/api/field-library?project_id=${projectId}`);
      if (!res.ok) return;
      const rows = await res.json();
      setLibrary(Array.isArray(rows) ? rows : []);
    } finally {
      setLibraryLoading(false);
    }
  };

  const loadDeleted = async () => {
    if (deleted) {
      setDeleted(null);
      return;
    }
    const res = await fetch(`/api/custom-fields/deleted?project_id=${projectId}`);
    if (!res.ok) return;
    const rows = await res.json();
    setDeleted(Array.isArray(rows) ? rows : []);
  };

  const removeLibraryEntry = async (id: number) => {
    setRemovingLibrary(id);
    try {
      const res = await fetch(`/api/field-library/${id}`, { method: "DELETE" });
      if (res.ok) {
        setLibrary((current) => (current ? current.filter((entry) => entry.id !== id) : current));
      }
    } finally {
      setRemovingLibrary(null);
    }
  };

  const restore = async (id: number) => {
    setRestoring(id);
    try {
      const res = await fetch(`/api/custom-fields/${id}/restore`, { method: "POST" });
      if (res.ok) {
        setDeleted((current) => (current ? current.filter((field) => field.id !== id) : current));
        onRestored();
      }
    } finally {
      setRestoring(null);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const choices = useMemo(() => {
    const types = showMore ? [...PRIMARY_TYPES, ...MORE_TYPES] : PRIMARY_TYPES;
    return types.filter(
      (item) =>
        query.trim() === "" ||
        item.label.includes(query.trim()) ||
        item.description.includes(query.trim()),
    );
  }, [query, showMore]);

  const width = 300;
  const maxHeight = 390;
  const left = Math.min(Math.max(anchor.right - width, 8), window.innerWidth - width - 8);
  const below = anchor.bottom + 6;
  const top =
    below + maxHeight <= window.innerHeight
      ? below
      : Math.max(8, anchor.top - maxHeight - 6);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="フィールドタイプ"
      data-field-type-menu
      style={{ position: "fixed", left, top, width, maxHeight }}
      className="z-[180] flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-surface shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
    >
      <div className="border-b border-neutral-100 px-3 py-2">
        <div className="text-[11px] font-semibold text-muted">フィールドタイプ</div>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="フィールドタイプを検索"
          aria-label="フィールドタイプを検索"
          className="mt-1.5 h-8 w-full rounded border border-neutral-200 px-2 text-[12px] outline-none focus:border-[#4075cf]"
        />
      </div>
      <div role="listbox" aria-label="フィールドタイプ" className="min-h-0 flex-1 overflow-y-auto p-1">
        {choices.map((item) => (
          <button
            key={item.type}
            type="button"
            role="option"
            aria-selected="false"
            data-field-type-option={item.type}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(item.type)}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-blue-50"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-200 bg-surface text-[12px] font-semibold text-secondary">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold text-neutral-800">{item.label}</span>
              <span className="block truncate text-[10px] text-muted">{item.description}</span>
            </span>
          </button>
        ))}
        {choices.length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] text-subtle">
            該当するフィールドタイプがありません
          </div>
        )}
        {query.trim() === "" && (
          <button
            type="button"
            data-field-type-more
            onClick={() => setShowMore((current) => !current)}
            className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-muted hover:bg-neutral-50 hover:text-neutral-700"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-line-strong text-[13px]">
              {showMore ? "−" : "＋"}
            </span>
            {showMore ? "表示を減らす" : "もっと表示"}
          </button>
        )}
        {query.trim() === "" && (
          <button
            type="button"
            data-field-library-toggle
            onClick={() => void loadLibrary()}
            className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-neutral-100 px-2 py-2 text-left text-[12px] text-muted hover:bg-neutral-50 hover:text-neutral-700"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-200 text-[12px]">
              ▤
            </span>
            {libraryLoading ? "読み込み中…" : library ? "ライブラリを閉じる" : "ライブラリから選択"}
          </button>
        )}
        {library && (
          <div className="mt-1 space-y-0.5 rounded-md border border-neutral-100 bg-surface-subtle p-1">
            {library.length === 0 && (
              <div className="px-2 py-2 text-[11px] text-subtle">ライブラリは空です</div>
            )}
            {library.map((entry) => (
              <div key={entry.id} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white">
                <button
                  type="button"
                  onClick={() => onPickTemplate(entry)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-[11px]"
                >
                  <span className="min-w-0 flex-1 truncate text-neutral-700">{entry.name}</span>
                  <span className="shrink-0 text-[9px] text-subtle">{entry.field_type}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${entry.name}をライブラリから削除`}
                  disabled={removingLibrary === entry.id}
                  onClick={() => void removeLibraryEntry(entry.id)}
                  className="shrink-0 rounded px-1 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-40"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {query.trim() === "" && (
          <button
            type="button"
            data-field-deleted-toggle
            onClick={() => void loadDeleted()}
            className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-neutral-100 px-2 py-2 text-left text-[12px] text-muted hover:bg-neutral-50 hover:text-neutral-700"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-200 text-[12px]">
              ♻
            </span>
            削除済みフィールド
          </button>
        )}
        {deleted && (
          <div className="mt-1 space-y-0.5 rounded-md border border-neutral-100 bg-surface-subtle p-1">
            {deleted.length === 0 && (
              <div className="px-2 py-2 text-[11px] text-subtle">削除済みフィールドはありません</div>
            )}
            {deleted.map((field) => (
              <div key={field.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-secondary">{field.name}</span>
                <button
                  type="button"
                  disabled={restoring === field.id}
                  onClick={() => void restore(field.id)}
                  className="rounded bg-white px-1.5 py-0.5 text-[10px] text-[#2f6fd0] shadow-sm hover:bg-blue-50 disabled:opacity-50"
                >
                  {restoring === field.id ? "復元中…" : "復元"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-neutral-100 px-3 py-2 text-[10px] text-subtle">
        AIスタジオ以外のフィールドタイプに対応
      </div>
    </div>,
    document.body,
  );
}
