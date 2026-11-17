"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Section, User } from "@/lib/data";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { projectDrawerTop } from "@/lib/drawer-position";
import TemplateBar from "../TemplateBar";

export type ListColumnOption = {
  key: string;
  label: string;
  visible: boolean;
};

const row =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-50";
const sectionTitle = "px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted";

const ICON_CHOICES = [
  "📋",
  "📝",
  "✅",
  "🚀",
  "🎯",
  "📊",
  "📅",
  "🗓️",
  "💬",
  "📁",
  "📌",
  "⭐",
  "🔥",
  "💡",
  "🧭",
  "🛠️",
  "🧪",
  "🎨",
  "🔔",
  "🏁",
] as const;

/** Asana-style right-side options drawer for the list view. */
export default function ListOptionsDrawer({
  open,
  onClose,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
  onRenameView,
  onUpdateIcon,
  subtasksCollapsed,
  onToggleSubtasks,
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
  canSaveView = true,
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
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
  onRenameView: (name: string) => Promise<void>;
  onUpdateIcon: (icon: string | null) => Promise<void>;
  subtasksCollapsed: boolean;
  onToggleSubtasks: (collapsed: boolean) => void;
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
  canSaveView?: boolean;
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
  const [iconDraft, setIconDraft] = useState(viewIcon);
  const [iconOpen, setIconOpen] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const [panelTop, setPanelTop] = useState(0);
  useFocusTrap(panelRef, open, onClose);

  useLayoutEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanelTop(projectDrawerTop());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPanelTop(projectDrawerTop());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNameDraft(viewName);
  }, [viewName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIconDraft(viewIcon);
  }, [viewIcon]);

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

  const chooseIcon = async (icon: string | null) => {
    if (renameDisabled || iconBusy) return;
    setIconBusy(true);
    setIconDraft(icon);
    try {
      await onUpdateIcon(icon);
      setIconOpen(false);
    } finally {
      setIconBusy(false);
    }
  };

  return (
    <div hidden={!open} aria-hidden={!open}>
      <button
        type="button"
        aria-label="オプションを閉じる"
        onClick={onClose}
        className="fixed inset-0 z-[70] cursor-default bg-transparent"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="リストのオプション"
        data-list-options-drawer
        style={{ top: panelTop, height: `calc(100vh - ${panelTop}px)` }}
        className="project-drawer-enter project-drawer-enter-options fixed right-0 z-[80] flex w-[min(480px,100vw)] flex-col overflow-y-auto bg-surface shadow-[-8px_0_30px_rgba(0,0,0,0.16)]"
      >
        <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-neutral-100 bg-surface px-4">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent-text" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.2M3 12h.2M3 18h.2" />
          </svg>
          <span className="flex-1 text-[15px] font-semibold text-neutral-900">リスト</span>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-lg leading-none text-subtle hover:bg-neutral-100 hover:text-neutral-700"
          >
            ×
          </button>
        </div>

        <div className="p-3">
          <div className="flex items-end gap-2 px-2">
            <div className="relative shrink-0">
              <label className="block text-[11px] font-medium text-muted">アイコン</label>
              <button
                type="button"
                data-list-view-icon
                aria-label="ビューのアイコン"
                aria-expanded={iconOpen}
                disabled={renameDisabled || iconBusy}
                onClick={() => setIconOpen((value) => !value)}
                className="mt-1 flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 text-lg hover:bg-neutral-50 disabled:bg-neutral-50"
              >
                {iconDraft ?? "📋"}
              </button>
              {iconOpen && (
                <div
                  data-list-icon-picker
                  className="absolute top-full left-0 z-20 mt-1 w-[250px] rounded-lg border border-neutral-200 bg-surface p-2 shadow-lg"
                >
                  <div className="grid grid-cols-8 gap-1">
                    {ICON_CHOICES.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        data-list-icon-choice={icon}
                        onClick={() => void chooseIcon(icon)}
                        className={`flex h-7 w-7 items-center justify-center rounded text-base hover:bg-neutral-100 ${
                          iconDraft === icon ? "bg-accent-soft" : ""
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void chooseIcon(null)}
                    className="mt-2 w-full rounded px-2 py-1 text-left text-[12px] text-secondary hover:bg-neutral-50"
                  >
                    アイコンをクリア
                  </button>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label className="block text-[11px] font-medium text-muted">ビューの名前</label>
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
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
            </div>
          </div>

          <div className="mt-2">
            <button
              type="button"
              data-list-columns-open
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((value) => !value)}
              className={row}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="16" rx="1.5" />
                <path d="M9 4v16M15 4v16" />
              </svg>
              <span className="flex-1">列を表示 / 非表示</span>
              <span className="text-[11px] text-subtle">{hiddenCount} 件が非表示</span>
            </button>
            {columnsOpen && (
              <div data-list-columns-panel className="mt-1 ml-2 border-l border-neutral-100 pl-3">
                <p className="px-2 pb-1 text-[11px] text-muted">
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
                  className="mt-1 flex h-8 items-center gap-1 rounded px-2 text-[12px] text-secondary hover:bg-neutral-50"
                >
                  <span className="text-[14px] leading-none">＋</span> フィールドを追加
                </button>
              </div>
            )}
          </div>

          <div className="mt-1">
            <button type="button" data-list-options-filter onClick={onOpenFilter} className={row}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
              </svg>
              <span className="flex-1">フィルター</span>
              <span className="text-[11px] text-subtle">{filterSummary}</span>
            </button>
            <button type="button" data-list-options-sort onClick={onOpenSort} className={row}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6h10M4 12h7M4 18h4M17 4v16M17 20l-3-3M17 20l3-3" />
              </svg>
              <span className="flex-1">ソート</span>
              <span className="text-[11px] text-subtle">{sortSummary}</span>
            </button>
            <button type="button" data-list-options-group onClick={onOpenGroup} className={row}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 5h16M4 12h16M4 19h16M7 3v4M7 10v4M7 17v4" />
              </svg>
              <span className="flex-1">グループ</span>
              <span className="text-[11px] text-subtle">{groupSummary}</span>
            </button>
            <button
              type="button"
              data-list-options-subtasks
              aria-pressed={subtasksCollapsed}
              onClick={() => onToggleSubtasks(!subtasksCollapsed)}
              className={row}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6h10M8 12h10M12 18h8" />
              </svg>
              <span className="flex-1">サブタスク</span>
              <span className="text-[11px] text-subtle">
                {subtasksCollapsed ? "折り畳み済み" : "展開済み"}
              </span>
            </button>
          </div>

          <div className={sectionTitle}>ビューの保存</div>
          <div className="px-2">
            {saving && canSaveView ? (
              <div className="flex items-center gap-1">
                <input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  onKeyDown={(event) => {
                    if (isImeComposing(event)) return;
                    if (event.key === "Enter") saveView();
                  }}
                  placeholder="ビュー名"
                  aria-label="保存するビュー名"
                  autoFocus
                  className="h-8 w-32 rounded border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8]"
                />
                <button onClick={saveView} aria-label="ビューを保存" className="h-8 rounded bg-accent px-2 text-[12px] text-white">
                  保存
                </button>
                <button onClick={() => setSaving(false)} aria-label="ビュー保存をキャンセル" className="text-sm text-muted">
                  ×
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSaving(true)}
                aria-label="現在のビューを保存"
                disabled={!canSaveView}
                title={!canSaveView ? "この集計条件から開いたリストは保存できません。通常のリストに戻って保存してください。" : undefined}
                className="text-[13px] text-secondary hover:text-black disabled:cursor-not-allowed disabled:text-neutral-400"
              >
                ビューを保存
              </button>
            )}
            {!canSaveView && <p className="mt-1 text-[11px] leading-4 text-muted">この集計条件から開いたリストは保存できません。通常のリストに戻って保存してください。</p>}
            <label className="mt-2 flex items-center gap-2 text-[13px] text-secondary" title="20秒ごとに自動更新（表示中のみ）">
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
