"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { TaskRow } from "@/lib/data";
import DueStateIcon from "../task/DueStateIcon";

export default function CalendarMultiDayBar({
  task,
  gridRow,
  colStart,
  colEnd,
  continuesLeft,
  continuesRight,
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
  onResizeDown,
  onResizeUp,
}: {
  task: TaskRow;
  gridRow: number;
  colStart: number;
  colEnd: number;
  continuesLeft: boolean;
  continuesRight: boolean;
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
  onResizeDown: (edge: "start" | "end", event: ReactPointerEvent<HTMLSpanElement>) => void;
  onResizeUp: (edge: "start" | "end", event: ReactPointerEvent<HTMLSpanElement>) => void;
}) {
  const cont =
    continuesLeft && continuesRight
      ? "both"
      : continuesLeft
        ? "left"
        : continuesRight
          ? "right"
          : "none";

  return (
    <div
      data-calendar-multiday={task.id}
      data-calendar-color-key={colorKey}
      data-calendar-color-tone={colorKey === "" ? "unset" : "set"}
      data-calendar-continues={cont}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={onKeyDown}
      title="クリックで開く / ドラッグで期日を変更"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`${taskFaceClass} relative touch-pan-y ${
        continuesLeft ? "rounded-l-none" : ""
      } ${continuesRight ? "rounded-r-none" : ""}`}
      style={{
        gridColumn: `${colStart + 1} / ${colEnd + 2}`,
        gridRow: gridRow + 1,
      }}
    >
      {continuesLeft && <span className="shrink-0 text-muted">‹</span>}
      {completion}
      {colorDot}
      {avatars}
      {overdue && task.is_milestone && <DueStateIcon state="overdue" className="text-danger" />}
      {overdue && <span className="sr-only">期限超過: </span>}
      <span
        title={task.name}
        dir="auto"
        className={`min-w-0 flex-1 truncate ${task.completed ? "text-muted line-through" : ""}`}
      >
        {task.name}
      </span>
      {meta}
      {continuesRight && <span className="shrink-0 text-muted">›</span>}
      <span
        data-calendar-resize="start"
        title="開始日を変更"
        onPointerDown={(event) => onResizeDown("start", event)}
        onPointerUp={(event) => onResizeUp("start", event)}
        className="absolute inset-y-0 left-0 z-20 w-2 touch-none cursor-ew-resize rounded-l bg-accent/0 hover:bg-accent/40"
      />
      <span
        data-calendar-resize="end"
        title="期日を変更"
        onPointerDown={(event) => onResizeDown("end", event)}
        onPointerUp={(event) => onResizeUp("end", event)}
        className="absolute inset-y-0 right-0 z-20 w-2 touch-none cursor-ew-resize rounded-r bg-accent/0 hover:bg-accent/40"
      />
    </div>
  );
}
