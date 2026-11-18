"use client";

import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import type { TaskRow } from "@/lib/data";

export default function CalendarDayCell({
  iso,
  taskCount,
  shownTasks,
  hiddenCount,
  expanded,
  weekMode,
  adding,
  draft,
  compact,
  inputRef,
  renderTask,
  onDragOver,
  onDrop,
  onExpand,
  onCollapse,
  onStartAdd,
  onDraftChange,
  onDraftKeyDown,
  onDraftBlur,
}: {
  iso: string;
  taskCount: number;
  shownTasks: TaskRow[];
  hiddenCount: number;
  expanded: boolean;
  weekMode: boolean;
  adding: boolean;
  draft: string;
  compact: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  renderTask: (task: TaskRow) => ReactNode;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onStartAdd: () => void;
  onDraftChange: (value: string) => void;
  onDraftKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onDraftBlur: () => void;
}) {
  return (
    <div
      data-calendar-day={iso}
      data-calendar-day-count={taskCount}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group relative border-r border-b border-line p-1 align-top ${
        weekMode ? "min-h-[320px]" : "min-h-[120px] max-h-[240px] overflow-y-auto"
      }`}
    >
      {shownTasks.map(renderTask)}
      {hiddenCount > 0 && (
        <button
          type="button"
          data-calendar-more={iso}
          onClick={onExpand}
          className="mt-0.5 flex h-6 w-full items-center rounded px-1 text-left text-[12px] font-medium text-accent-text hover:bg-hover"
        >
          +{hiddenCount} 件
        </button>
      )}
      {!weekMode && expanded && taskCount > 3 && (
        <button
          type="button"
          data-calendar-collapse={iso}
          onClick={onCollapse}
          className="mt-0.5 flex h-6 w-full items-center rounded px-1 text-left text-[12px] text-muted hover:bg-hover"
        >
          折りたたむ
        </button>
      )}
      {adding ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onDraftKeyDown}
          onBlur={onDraftBlur}
          placeholder="タスク名を入力"
          className="h-8 w-full rounded border border-accent px-2 text-[13px] outline-none"
        />
      ) : (
        !compact &&
        !weekMode && (
          <button
            type="button"
            onClick={onStartAdd}
            className="flex h-8 w-full items-center rounded px-1 text-left text-[12px] text-subtle opacity-0 hover:bg-hover hover:text-secondary group-hover:opacity-100 focus:opacity-100"
          >
            ＋ タスクを追加
          </button>
        )
      )}
    </div>
  );
}
