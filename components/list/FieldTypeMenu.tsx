"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CustomFieldType } from "@/lib/custom-fields";

export type FieldTypeChoice = {
  type: CustomFieldType;
  label: string;
  description: string;
  icon: string;
};

const TYPES: FieldTypeChoice[] = [
  { type: "select", label: "単一選択", description: "1つの選択肢を選ぶ", icon: "◉" },
  { type: "multi_select", label: "複数選択", description: "複数の選択肢を選ぶ", icon: "☑" },
  { type: "date", label: "日付", description: "日付を入力する", icon: "📅" },
  { type: "text", label: "テキスト", description: "自由入力の短いテキスト", icon: "T" },
  { type: "number", label: "数値", description: "金額・数量・集計に使う", icon: "#" },
];

/** Asana-style listbox anchored to the trailing "+" field header. */
export default function FieldTypeMenu({
  anchor,
  onPick,
  onClose,
}: {
  anchor: { left: number; right: number; top: number; bottom: number };
  onPick: (type: CustomFieldType) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

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

  const choices = useMemo(
    () =>
      TYPES.filter(
        (item) =>
          query.trim() === "" ||
          item.label.includes(query.trim()) ||
          item.description.includes(query.trim()),
      ),
    [query],
  );

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
      className="z-[180] flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
    >
      <div className="border-b border-neutral-100 px-3 py-2">
        <div className="text-[11px] font-semibold text-neutral-500">フィールドタイプ</div>
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
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-200 bg-white text-[12px] font-semibold text-neutral-600">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold text-neutral-800">{item.label}</span>
              <span className="block truncate text-[10px] text-neutral-500">{item.description}</span>
            </span>
          </button>
        ))}
        {choices.length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] text-neutral-400">
            該当するフィールドタイプがありません
          </div>
        )}
      </div>
      <div className="border-t border-neutral-100 px-3 py-2 text-[10px] text-neutral-400">
        メンバー・数式・集計などは順次対応予定
      </div>
    </div>,
    document.body,
  );
}
