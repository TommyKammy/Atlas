"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import type { ListGroupBy } from "@/lib/list-view";

export type ListSectionHeaderProps = {
  groupKey: string;
  name: string;
  count: number;
  depth?: number;
  sectionId?: number;
  collapsed: boolean;
  groupBy: ListGroupBy;
  group2: ListGroupBy | null;
  sectionDragging: number | null;
  dropTargetId: number | null;
  editingSection: number | null;
  sectionEditName: string;
  sectionMenuId: number | null;
  canEdit: boolean;
  onToggle: () => void;
  onBeginEdit: (id: number, name: string) => void;
  onEditNameChange: (value: string) => void;
  onSaveName: (id: number) => void;
  onCancelEdit: () => void;
  onAddTask: (id: number) => void;
  onOpenMenu: (event: React.MouseEvent, id: number) => void;
  onDragStart: (event: React.DragEvent, id: number, name: string) => void;
  onDragEnd: () => void;
};

/** Section/subgroup heading shared by section groups and secondary groups. */
export default function ListSectionHeader({
  groupKey,
  name,
  count,
  depth = 0,
  sectionId,
  collapsed,
  groupBy,
  group2,
  sectionDragging,
  dropTargetId,
  editingSection,
  sectionEditName,
  sectionMenuId,
  canEdit,
  onToggle,
  onBeginEdit,
  onEditNameChange,
  onSaveName,
  onCancelEdit,
  onAddTask,
  onOpenMenu,
  onDragStart,
  onDragEnd,
}: ListSectionHeaderProps) {
  const sectionDrag = sectionId !== undefined && groupBy === "section";
  const target = sectionId !== undefined && dropTargetId === sectionId;
  const controlsVisible = editingSection === sectionId || sectionMenuId === sectionId;
  const controlVisibility = controlsVisible
    ? "opacity-100"
    : "opacity-0 group-hover/section-name:opacity-100 group-focus-within/section-name:opacity-100";

  return (
    <div
      data-list-section-header={groupKey}
      data-list-section-depth={depth}
      data-section-id={sectionId}
      data-section-dragging={sectionDragging === sectionId ? "true" : undefined}
      className={`relative flex h-[37px] items-center gap-2 ${depth > 0 ? "pl-10" : "pl-6"} ${
        sectionDragging === sectionId
          ? "bg-[#f3f3f3]/70 [&>*]:invisible"
          : target
            ? "bg-[#f3f3f3]"
            : ""
      }`}
    >
      <button
        onClick={onToggle}
        title={collapsed ? "展開する" : "折りたたむ"}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
      >
        <svg
          viewBox="0 0 12 12"
          className={`h-3 w-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          fill="currentColor"
        >
          <path d="M2.2 4.2h7.6L6 9.2z" />
        </svg>
      </button>
      {sectionDrag ? (
        <div className="group/section-name flex min-w-0 shrink-0 items-center">
          {editingSection === sectionId ? (
            <input
              data-section-name-input={sectionId}
              value={sectionEditName}
              onChange={(event) => onEditNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (isImeComposing(event)) return;
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onSaveName(sectionId);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  onCancelEdit();
                }
              }}
              onBlur={() => onSaveName(sectionId)}
              aria-label="セクション名"
              autoFocus
              className="h-9 w-[200px] rounded border border-[#4573d2] bg-white px-2 text-[14px] font-semibold text-neutral-900 ring-2 ring-[#4573d2]/15 outline-none"
            />
          ) : (
            <button
              type="button"
              data-section-name={sectionId}
              onClick={() => onBeginEdit(sectionId, name)}
              title="クリックしてセクション名を変更"
              className="max-w-[360px] cursor-pointer truncate text-left text-[14px] leading-6 font-semibold text-neutral-900"
            >
              {name}
            </button>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                data-section-add-task={sectionId}
                onClick={() => onAddTask(sectionId)}
                title="このセクションにタスクを追加"
                aria-label="このセクションにタスクを追加"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-500 transition-opacity hover:bg-neutral-200/70 hover:text-neutral-800 ${controlVisibility}`}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                data-section-menu-button={sectionId}
                onClick={(event) => onOpenMenu(event, sectionId)}
                title="セクションのその他のアクション"
                aria-label="セクションのその他のアクション"
                aria-haspopup="menu"
                aria-expanded={sectionMenuId === sectionId}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-500 transition-opacity hover:bg-neutral-200/70 hover:text-neutral-800 ${controlVisibility}`}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                  <circle cx="3" cy="8" r="1.3" />
                  <circle cx="8" cy="8" r="1.3" />
                  <circle cx="13" cy="8" r="1.3" />
                </svg>
              </button>
            </>
          )}
        </div>
      ) : (
        <span className="text-[14px] leading-6 font-semibold text-neutral-900">{name}</span>
      )}
      {groupBy !== "section" || group2 !== null ? (
        <span data-list-section-count={count} className="text-[13px] font-normal text-neutral-500">
          {count}
        </span>
      ) : null}
      {sectionDrag && (
        <div
          data-section-drag-handle={sectionId}
          draggable
          onDragStart={(event) => onDragStart(event, sectionId, name)}
          onDragEnd={onDragEnd}
          title="ドラッグしてセクションを移動"
          className="h-full min-w-6 flex-1 cursor-grab select-none"
        />
      )}
    </div>
  );
}
