"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { projectDrawerTop } from "@/lib/drawer-position";
import { VIEW_ICON_CHOICES } from "@/lib/view-icons";
import { useFocusTrap } from "@/lib/use-focus-trap";

const row =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-50";

/** Shared Asana-style right drawer for board/timeline/calendar view options. */
export default function ViewOptionsDrawer({
  open,
  onClose,
  title,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
  onRenameView,
  onUpdateIcon,
  filterSummary,
  sortSummary,
  groupSummary,
  onOpenFilter,
  onOpenSort,
  onOpenGroup,
  showSort = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
  onRenameView: (name: string) => Promise<void>;
  onUpdateIcon: (icon: string | null) => Promise<void>;
  filterSummary: string;
  sortSummary: string;
  groupSummary?: string;
  onOpenFilter: () => void;
  onOpenSort: () => void;
  onOpenGroup?: () => void;
  showSort?: boolean;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNameDraft(viewName);
  }, [viewName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIconDraft(viewIcon);
  }, [viewIcon]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPanelTop(projectDrawerTop());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const renameDisabled = !canEdit || viewTabId === null;

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
        aria-label={`${title}のオプションを閉じる`}
        onClick={onClose}
        className="fixed inset-0 z-[70] cursor-default bg-transparent"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${title}のオプション`}
        data-view-options-drawer={title}
        style={{ top: panelTop, height: `calc(100vh - ${panelTop}px)` }}
        className="project-drawer-enter project-drawer-enter-options fixed right-0 z-[80] flex w-[min(480px,100vw)] flex-col overflow-y-auto bg-surface shadow-[-8px_0_30px_rgba(0,0,0,0.16)]"
      >
        <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-neutral-100 bg-surface px-4">
          <span className="text-[16px] leading-none">{iconDraft ?? "📋"}</span>
          <span className="flex-1 text-[15px] font-semibold text-neutral-900">{title}</span>
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
                aria-label={`${title}のアイコン`}
                aria-expanded={iconOpen}
                disabled={renameDisabled || iconBusy}
                onClick={() => setIconOpen((value) => !value)}
                className="mt-1 flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 text-lg hover:bg-neutral-50 disabled:bg-neutral-50"
              >
                {iconDraft ?? "📋"}
              </button>
              {iconOpen && (
                <div className="absolute top-full left-0 z-20 mt-1 w-[250px] rounded-lg border border-neutral-200 bg-surface p-2 shadow-lg">
                  <div className="grid grid-cols-8 gap-1">
                    {VIEW_ICON_CHOICES.map((icon) => (
                      <button
                        key={icon}
                        type="button"
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
                className="mt-1 h-9 w-full rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8] disabled:bg-neutral-50 disabled:text-neutral-500"
              />
            </div>
          </div>

          <div className="mt-2">
            <button type="button" data-view-options-filter onClick={onOpenFilter} className={row}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
              </svg>
              <span className="flex-1">フィルター</span>
              <span className="text-[11px] text-subtle">{filterSummary}</span>
            </button>
            {showSort && (
              <button type="button" data-view-options-sort onClick={onOpenSort} className={row}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 6h10M4 12h7M4 18h4M17 4v16M17 20l-3-3M17 20l3-3" />
                </svg>
                <span className="flex-1">ソート</span>
                <span className="text-[11px] text-subtle">{sortSummary}</span>
              </button>
            )}
            {groupSummary !== undefined && onOpenGroup && (
              <button type="button" data-view-options-group onClick={onOpenGroup} className={row}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 5h16M4 12h16M4 19h16M7 3v4M7 10v4M7 17v4" />
                </svg>
                <span className="flex-1">グループ</span>
                <span className="text-[11px] text-subtle">{groupSummary}</span>
              </button>
            )}
          </div>

          {children}

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
