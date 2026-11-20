"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import type { ListGroupBy } from "@/lib/list-view";
import SectionDraftInput from "../sections/SectionDraftInput";

/**
 * Name input for a new or renamed section. The box is pulled left by its own
 * border + padding (1px + 7px) so the typed text starts exactly where section
 * names start, and it is 32px tall inside the 38px heading row. This keeps the
 * text from shifting when the heading switches between label and input.
 */
const sectionNameInputClass =
  "-ml-2 h-8 w-[240px] max-w-[360px] rounded border border-accent bg-field px-[7px] text-[14px] leading-6 font-semibold text-text ring-2 ring-focus-ring/15 outline-none disabled:bg-surface-subtle";

export type ListSectionHeaderProps = {
  groupKey: string;
  name: string;
  count: number;
  depth?: number;
  sectionId?: number;
  collapsed: boolean;
  groupBy: ListGroupBy;
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
  draft?: {
    name: string;
    saving: boolean;
    error: string | null;
    onNameChange: (value: string) => void;
    onCommit: (origin: "enter" | "blur") => void;
    onCancel: () => void;
  } | null;
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
  draft = null,
}: ListSectionHeaderProps) {
  const draftMode = draft !== null;
  const sectionDrag = draftMode || (sectionId !== undefined && groupBy === "section");
  const target = !draftMode && sectionId !== undefined && dropTargetId === sectionId;
  const controlsVisible =
    draftMode || editingSection === sectionId || sectionMenuId === sectionId;
  const controlVisibility = controlsVisible
    ? "opacity-100"
    : "opacity-0 group-hover/section-name:opacity-100 group-focus-within/section-name:opacity-100";

  return (
    <div
      data-list-section-header={draftMode ? "draft" : groupKey}
      data-list-section-depth={depth}
      data-section-id={sectionId}
      data-section-draft={draftMode ? "true" : undefined}
      data-section-dragging={!draftMode && sectionDragging === sectionId ? "true" : undefined}
      className={`relative flex h-[38px] items-center gap-2 ${depth > 0 ? "pl-10" : "pl-6"} ${
        !draftMode && sectionDragging === sectionId
          ? "bg-surface-muted/70 [&>*]:invisible"
          : target
            ? "bg-surface-muted"
            : ""
      }`}
    >
      <button
        onClick={onToggle}
        disabled={draftMode}
        title={collapsed ? "展開する" : "折りたたむ"}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-text disabled:hover:bg-transparent"
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
          {draft ? (
            <SectionDraftInput
              value={draft.name}
              onChange={draft.onNameChange}
              onCommit={draft.onCommit}
              onCancel={draft.onCancel}
              saving={draft.saving}
              error={draft.error}
              className={sectionNameInputClass}
              errorClassName="absolute left-6 top-full z-20 mt-1 w-[280px] rounded border border-danger-line bg-surface px-2 py-1 text-[12px] text-danger shadow"
            />
          ) : editingSection === sectionId ? (
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
              className={sectionNameInputClass}
            />
          ) : (
            <button
              type="button"
              data-section-name={sectionId}
              onClick={() => {
                if (sectionId !== undefined) onBeginEdit(sectionId, name);
              }}
              title="クリックしてセクション名を変更"
              className="max-w-[360px] cursor-pointer truncate text-left text-[14px] leading-6 font-semibold text-text"
            >
              {name}
            </button>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                data-section-add-task={draftMode ? undefined : sectionId}
                onClick={() => {
                  if (!draftMode && sectionId !== undefined) onAddTask(sectionId);
                }}
                disabled={draftMode}
                title="このセクションにタスクを追加"
                aria-label="このセクションにタスクを追加"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted transition-opacity hover:bg-surface-strong/70 hover:text-text disabled:hover:bg-transparent ${controlVisibility}`}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                data-section-menu-button={draftMode ? undefined : sectionId}
                onClick={(event) => {
                  if (!draftMode && sectionId !== undefined) onOpenMenu(event, sectionId);
                }}
                disabled={draftMode}
                title="セクションのその他のアクション"
                aria-label="セクションのその他のアクション"
                aria-haspopup="menu"
                aria-expanded={!draftMode && sectionMenuId === sectionId}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted transition-opacity hover:bg-surface-strong/70 hover:text-text disabled:hover:bg-transparent ${controlVisibility}`}
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
        <span className="text-[14px] leading-6 font-semibold text-text">{name}</span>
      )}
      <span data-list-section-count={count} className="text-[12px] font-normal text-muted">
        {count}
      </span>
      {sectionDrag &&
        (draftMode ? (
          <div
            aria-hidden
            data-section-draft-drag
            className="h-full min-w-6 flex-1 cursor-default select-none"
          />
        ) : (
          sectionId !== undefined && (
            <div
              data-section-drag-handle={sectionId}
              draggable
              onDragStart={(event) => onDragStart(event, sectionId, name)}
              onDragEnd={onDragEnd}
              title="ドラッグしてセクションを移動"
              className="h-full min-w-6 flex-1 cursor-grab select-none"
            />
          )
        ))}
    </div>
  );
}
