"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { TaskRow } from "@/lib/data";

export default function CalendarSingleTask({
  task,
  colorKey,
  taskFaceClass,
  completion,
  avatars,
  meta,
  onDragStart,
  onDragEnd,
  onClick,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  task: TaskRow;
  colorKey: string;
  taskFaceClass: string;
  completion: ReactNode;
  avatars: ReactNode;
  meta: ReactNode;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
}) {
  return (
    <div
      data-calendar-single={task.id}
      data-calendar-color-key={colorKey}
      data-calendar-color-tone={colorKey === "" ? "unset" : "set"}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={onKeyDown}
      title="クリックで開く / ドラッグで期日を変更"
      className={`${taskFaceClass} touch-pan-y`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {completion}
      {avatars}
      <span title={task.name} dir="auto" className={`min-w-0 flex-1 truncate ${task.completed ? "line-through" : ""}`}>
        {task.name}
      </span>
      {meta}
    </div>
  );
}
