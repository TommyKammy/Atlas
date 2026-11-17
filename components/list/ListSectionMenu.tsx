"use client";

import type { Section } from "@/lib/data";

export type SectionMenuState = { id: number; left: number; top: number };

/** Section context menu overlay shared by the list and grouped views. */
export default function ListSectionMenu({
  menu,
  sections,
  onClose,
  onRename,
  onAddSection,
  onToggleCollapse,
  onDelete,
}: {
  menu: SectionMenuState | null;
  sections: Section[];
  onClose: () => void;
  onRename: (section: Section) => void;
  onAddSection: () => void;
  onToggleCollapse: (sectionId: number) => void;
  onDelete: (section: Section) => void;
}) {
  if (!menu) return null;
  const section = sections.find((item) => item.id === menu.id);
  if (!section) return null;
  const itemClass =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100";

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        role="menu"
        data-section-menu={section.id}
        aria-label="セクションのその他のアクション"
        className="fixed z-[61] w-[268px] rounded-lg border border-[#e1e1e1] bg-surface py-1 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
        style={{ left: menu.left, top: menu.top }}
      >
        <button
          type="button"
          role="menuitem"
          data-section-menu-action="rename"
          onClick={() => onRename(section)}
          className={itemClass}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M11.3 2.7a1.6 1.6 0 0 1 2.2 2.2L5.7 12.7 2.7 13.3l.6-3z" strokeLinejoin="round" />
          </svg>
          セクション名を変更
        </button>
        <button
          type="button"
          role="menuitem"
          data-section-menu-action="add"
          onClick={onAddSection}
          className={itemClass}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
          セクションを追加
        </button>
        <button
          type="button"
          role="menuitem"
          data-section-menu-action="collapse"
          onClick={() => onToggleCollapse(section.id)}
          className={itemClass}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M3 4h10M4.5 8h7M6 12h4" strokeLinecap="round" />
          </svg>
          グループを展開または折り畳む
        </button>
        <div className="my-1 border-t border-neutral-200" />
        <button
          type="button"
          role="menuitem"
          data-section-menu-action="delete"
          onClick={() => onDelete(section)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-danger hover:bg-red-50"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M3 4.5h10M6.5 2.5h3M4.5 4.5l.7 9h5.6l.7-9M6.8 7v4M9.2 7v4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          セクションを削除
        </button>
      </div>
    </>
  );
}
