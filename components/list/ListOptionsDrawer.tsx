"use client";

import { useEffect, useRef, useState } from "react";
import type { Section, User } from "@/lib/data";
import { useFocusTrap } from "@/lib/use-focus-trap";
import TemplateBar from "../TemplateBar";

export type ListColumnOption = {
  key: string;
  label: string;
  visible: boolean;
};

const row =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-50";
const sectionTitle = "px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-neutral-500";

/** Asana-style right-side options drawer for the list view. */
export default function ListOptionsDrawer({
  open,
  onClose,
  viewName,
  viewTabId,
  canEdit,
  onRenameView,
  columns,
  onToggleColumn,
  onAddField,
  filterSummary,
  sortSummary,
  groupSummary,
  onOpenFilter,
  onOpenSort,
  onOpenGroup,
  saving,
  setSaving,
  saveName,
  setSaveName,
  saveView,
  autoRefresh,
  setAutoRefresh,
  lastRefresh,
  projectId,
  sections,
  users,
}: {
  open: boolean;
  onClose: () => void;
  viewName: string;
  viewTabId: number | null;
  canEdit: boolean;
  onRenameView: (name: string) => Promise<void>;
  columns: ListColumnOption[];
  onToggleColumn: (key: string) => void;
  onAddField: () => void;
  filterSummary: string;
  sortSummary: string;
  groupSummary: string;
  onOpenFilter: () => void;
  onOpenSort: () => void;
  onOpenGroup: () => void;
  saving: boolean;
  setSaving: (value: boolean) => void;
  saveName: string;
  setSaveName: (value: string) => void;
  saveView: () => void;
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
  lastRefresh: string | null;
  projectId: number;
  sections: Section[];
  users: User[];
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(viewName);
  const [renameBusy, setRenameBusy] = useState(false);
  useFocusTrap(panelRef, open, onClose);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNameDraft(viewName);
  }, [viewName]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const renameDisabled = !canEdit || viewTabId === null;
  const hiddenCount = columns.filter((column) => !column.visible).length;

  const commitName = async () => {
    const next = nameDraft.trim();
    if (renameDisabled || renameBusy || next === "" || next === viewName) return;
    setRenameBusy(true);
    try {
      await onRenameView(next);
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <div hidden={!open} aria-hidden={!open}>
      <button
        type="button"
        aria-label="オプションを閉じる"
        onClick={onClose}
        className="fixed inset-0 z-[70] bg-black/20"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="リストのオプション"
        data-list-options-drawer
        className="fixed top-0 right-0 z-[80] flex h-full w-[min(440px,100vw)] flex-col overflow-y-auto bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.16)]"
      >
        <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-neutral-100 bg-white px-4">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#2c60b8]" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.2M3 12h.2M3 18h.2" />
          </svg>
          <span className="flex-1 text-[15px] font-semibold text-neutral-900">リスト</span>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-lg leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ×
          </button>
        </div>

        <div className="p-3">
          <label className="block px-2 text-[11px] font-medium text-neutral-500">ビューの名前</label>
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitName();
              }
            }}
            disabled={renameDisabled || renameBusy}
            aria-label="ビューの名前"
            data-list-view-name
            className="mt-1 h-9 w-full rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8] disabled:bg-neutral-50 disabled:text-neutral-500"
          />

          <div className="mt-2">
            <button
              type="button"
              data-list-columns-open
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((value) => !value)}
              className={row}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="16" rx="1.5" />
                <path d="M9 4v16M15 4v16" />
              </svg>
              <span className="flex-1">列を表示 / 非表示</span>
              <span className="text-[11px] text-neutral-400">{hiddenCount} 件が非表示</span>
            </button>
            {columnsOpen && (
              <div data-list-columns-panel className="mt-1 ml-2 border-l border-neutral-100 pl-3">
                <p className="px-2 pb-1 text-[11px] text-neutral-500">
                  このビューの列の表示、非表示、並び替えができます
                </p>
                {columns.map((column) => (
                  <label
                    key={column.key}
                    className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-neutral-700 hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      checked={column.visible}
                      data-list-column-toggle={column.key}
                      onChange={() => onToggleColumn(column.key)}
                      className="h-3.5 w-3.5 accent-[#2c60b8]"
                    />
                    <span className="min-w-0 flex-1 truncate">{column.label}</span>
                  </label>
                ))}
                <button
                  type="button"
                  onClick={onAddField}
                  className="mt-1 flex h-8 items-center gap-1 rounded px-2 text-[12px] text-neutral-600 hover:bg-neutral-50"
                >
                  <span className="text-[14px] leading-none">＋</span> フィールドを追加
                </button>
              </div>
            )}
          </div>

          <div className="mt-1">
            <button type="button" data-list-options-filter onClick={onOpenFilter} className={row}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
              </svg>
              <span className="flex-1">フィルター</span>
              <span className="text-[11px] text-neutral-400">{filterSummary}</span>
            </button>
            <button type="button" data-list-options-sort onClick={onOpenSort} className={row}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6h10M4 12h7M4 18h4M17 4v16M17 20l-3-3M17 20l3-3" />
              </svg>
              <span className="flex-1">ソート</span>
              <span className="text-[11px] text-neutral-400">{sortSummary}</span>
            </button>
            <button type="button" data-list-options-group onClick={onOpenGroup} className={row}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 5h16M4 12h16M4 19h16M7 3v4M7 10v4M7 17v4" />
              </svg>
              <span className="flex-1">グループ</span>
              <span className="text-[11px] text-neutral-400">{groupSummary}</span>
            </button>
          </div>

          <div className={sectionTitle}>ビューの保存</div>
          <div className="px-2">
            {saving ? (
              <div className="flex items-center gap-1">
                <input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveView();
                  }}
                  placeholder="ビュー名"
                  aria-label="保存するビュー名"
                  autoFocus
                  className="h-8 w-32 rounded border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8]"
                />
                <button onClick={saveView} aria-label="ビューを保存" className="h-8 rounded bg-[#2c60b8] px-2 text-[12px] text-white">
                  保存
                </button>
                <button onClick={() => setSaving(false)} aria-label="ビュー保存をキャンセル" className="text-sm text-neutral-500">
                  ×
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSaving(true)}
                aria-label="現在のビューを保存"
                className="text-[13px] text-neutral-600 hover:text-black"
              >
                ビューを保存
              </button>
            )}
            <label className="mt-2 flex items-center gap-2 text-[13px] text-neutral-600" title="20秒ごとに自動更新（表示中のみ）">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              自動更新{lastRefresh ? `（${lastRefresh}）` : ""}
            </label>
          </div>

          <div className="mt-2 px-2">
            <TemplateBar projectId={projectId} sections={sections} users={users} />
          </div>

          <div className="mt-4 border-t border-neutral-100 px-2 pt-3">
            <a href="/help" className="text-[12px] text-[#6d5bd0] hover:underline">
              フィードバックを送る
            </a>
          </div>
        </div>
      </aside>
    </div>
  );
}
