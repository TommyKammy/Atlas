"use client";
import { QuickTaskName } from "../task/QuickTaskContext";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { TaskRow } from "@/lib/data";
import DueStateIcon from "../task/DueStateIcon";

export default function CalendarSingleTask({
  task,
  colorKey,
  colorDot,
  overdue,
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
  colorDot?: ReactNode;
  overdue: boolean;
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
      {colorDot}
      {avatars}
      {overdue && task.is_milestone && <DueStateIcon state="overdue" className="text-danger" />}
      {overdue && <span className="sr-only">期限超過: </span>}
      <span
        title={task.name}
        dir="auto"
        className={`min-w-0 flex-1 truncate text-[12px] whitespace-nowrap ${task.completed ? "text-muted line-through" : ""}`}
      >
        <QuickTaskName task={task}>{task.name || "タスク名を入力"}</QuickTaskName>
      </span>
      {meta}
    </div>
  );
}
