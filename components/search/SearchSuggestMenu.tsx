"use client";

import Link from "next/link";
import type { SearchSuggestOption } from "@/lib/search-types";
import { searchOptionId } from "@/lib/search-types";

const SECTION_LABELS: Record<SearchSuggestOption["group"], string> = {
  history: "最近の検索",
  tasks: "タスク",
  projects: "プロジェクト",
  messages: "メッセージ",
  knowledge: "知識",
  files: "ファイル",
};
const GROUP_ORDER: SearchSuggestOption["group"][] = [
  "history",
  "tasks",
  "projects",
  "messages",
  "knowledge",
  "files",
];
const sectionLabel = "px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400";
const rowClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-neutral-800 hover:bg-neutral-100 aria-selected:bg-blue-50";

/** Dropdown listbox shared by the global search box. */
export default function SearchSuggestMenu({
  open,
  q,
  options,
  loading,
  activeIndex,
  onClearHistory,
  onSelect,
}: {
  open: boolean;
  q: string;
  options: SearchSuggestOption[];
  loading: boolean;
  activeIndex: number;
  onClearHistory: () => void;
  onSelect: () => void;
}) {
  if (!open) return null;
  const hasHistory = q === "" && options.length > 0;
  const showEmpty = q !== "" && !loading && options.length === 0;
  return (
    <div
      id="global-search-menu"
      data-global-search-menu
      role="listbox"
      aria-label="検索候補"
      className="absolute top-full right-0 left-0 z-50 mt-2 max-h-[70vh] overflow-auto rounded-lg border border-neutral-200 bg-white py-1 text-neutral-900 shadow-2xl"
    >
      {q === "" ? (
        hasHistory ? (
          <div data-global-search-history>
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="text-[11px] font-semibold tracking-wide text-neutral-400">最近の検索</span>
              <button
                type="button"
                data-global-search-clear
                onClick={onClearHistory}
                className="text-[11px] text-neutral-500 hover:underline"
              >
                履歴をクリア
              </button>
            </div>
            {options.map((option, index) => (
              <Link
                key={option.key}
                id={searchOptionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                data-global-search-history-item={option.label}
                href={option.href}
                onClick={onSelect}
                className={rowClass}
              >
                <span className="text-neutral-400">↺</span>
                <span className="truncate">{option.label}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 text-[12px] text-neutral-500">
            検索履歴はありません。キーワードを入力してください。
          </div>
        )
      ) : (
        <>
          {GROUP_ORDER.filter((group) => group !== "history").map((group) => {
            const entries = options
              .map((option, index) => ({ option, index }))
              .filter((entry) => entry.option.group === group);
            if (entries.length === 0) return null;
            return (
              <div key={group} data-global-search-group={group}>
                <div className={sectionLabel}>{SECTION_LABELS[group]}</div>
                {entries.map(({ option, index }) => (
                  <Link
                    key={option.key}
                    id={searchOptionId(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-global-search-option={option.key}
                    href={option.href}
                    onClick={onSelect}
                    className={rowClass}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.sublabel && (
                      <span className="shrink-0 text-[11px] text-neutral-400">{option.sublabel}</span>
                    )}
                  </Link>
                ))}
              </div>
            );
          })}
          {showEmpty && (
            <div data-global-search-empty className="px-3 py-4 text-center text-[13px] text-neutral-500">
              「{q}」に一致する結果はありません
            </div>
          )}
          {loading && <div className="px-3 py-2 text-[12px] text-neutral-400">検索中…</div>}
          <Link
            href={`/search?q=${encodeURIComponent(q)}`}
            data-global-search-all
            onClick={onSelect}
            className="mt-1 flex items-center justify-between border-t border-neutral-100 px-3 py-2 text-[12px] font-medium text-[#2c60b8] hover:bg-neutral-50"
          >
            すべての検索結果を表示
            <span aria-hidden="true">→</span>
          </Link>
        </>
      )}
    </div>
  );
}
