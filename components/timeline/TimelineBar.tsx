"use client";

import { memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { TaskRow } from "@/lib/data";
import TaskAvatar from "../task/TaskAvatar";
import TaskCompletionToggle from "../task/TaskCompletionToggle";
import TaskMilestoneIcon from "../task/TaskMilestoneIcon";

export type TimelineBarProps = {
  task: TaskRow;
  lane: number;
  rowLocked: boolean;
  overlapping: boolean;
  externalLabel: boolean;
  onMoveRow: (delta: number) => void;
  x1: string;
  x2: string;
  skinny: boolean;
  sameDay: boolean;
  labelOnLeft: boolean;
  active: boolean;
  dragMode: "move" | "start" | "end" | null;
  dx: number;
  hovered: boolean;
  overflow: boolean;
  dependencyTarget: boolean;
  showAvatar: boolean;
  showSubtasks: boolean;
  barFaceClass: string;
  barStyle: CSSProperties;
  startHandleStyle: CSSProperties;
  endHandleStyle: CSSProperties;
  activeGuideLeft: string | number | undefined;
  barInfo: string;
  onBarPointerDown: (event: ReactPointerEvent) => void;
  onBarPointerMove: (event: ReactPointerEvent) => void;
  onBarPointerUp: (event: ReactPointerEvent) => void;
  onBarClick: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onBarEnter: () => void;
  onBarLeave: () => void;
  onStartDrag: (event: ReactPointerEvent) => void;
  onEndDrag: (event: ReactPointerEvent) => void;
  onStartDependency: (event: ReactPointerEvent) => void;
  onEndDependency: (event: ReactPointerEvent) => void;
  onDependencyUp: (event: ReactPointerEvent) => void;
  onDependencyMove: (event: ReactPointerEvent) => void;
  onDependencyEnter: () => void;
  onDependencyLeave: () => void;
  onToggleComplete: () => void;
};

function TimelineBar({
  task,
  lane,
  rowLocked,
  overlapping,
  externalLabel,
  onMoveRow,
  x1,
  x2,
  skinny,
  sameDay,
  labelOnLeft,
  active,
  dragMode,
  dx,
  hovered,
  overflow,
  dependencyTarget,
  showAvatar,
  showSubtasks,
  barFaceClass,
  barStyle,
  startHandleStyle,
  endHandleStyle,
  activeGuideLeft,
  barInfo,
  onBarPointerDown,
  onBarPointerMove,
  onBarPointerUp,
  onBarClick,
  onBarEnter,
  onBarLeave,
  onStartDrag,
  onEndDrag,
  onStartDependency,
  onEndDependency,
  onDependencyUp,
  onDependencyMove,
  onDependencyEnter,
  onDependencyLeave,
  onToggleComplete,
}: TimelineBarProps) {
  const completionLeft = `calc(${x1} + 4px)`;
  const milestone = task.is_milestone;
  const markerStyle = sameDay || milestone;
  const collapsedMarker = markerStyle && !hovered && !active;
  const labelHidden = markerStyle && hovered;
  const outsideLabel = (
    <span
      data-timeline-bar-label={task.id}
      dir="auto"
      title={task.name}
      className={`absolute top-1/2 -translate-y-1/2 truncate text-[12px] font-medium whitespace-nowrap text-[#050505] ${
        labelOnLeft ? "right-full mr-2 text-right" : "left-full ml-2"
      } ${task.completed ? "line-through" : ""} ${labelHidden ? "opacity-0" : ""}`}
      style={{ maxWidth: 172 }}
    >
      {task.name}
    </span>
  );
  const dependencyHandleClass = (visible: boolean) =>
    `absolute z-40 flex h-3.5 w-3.5 cursor-crosshair items-center justify-center rounded-full border border-neutral-400 bg-white shadow-sm hover:border-[#2c60b8] hover:bg-[#2c60b8] ${
      visible ? "opacity-100" : "pointer-events-none opacity-0"
    }`;

  return (
    <div className="relative h-10" data-timeline-row={task.id} data-timeline-lane={lane}>
      <div
        data-timeline-bar={task.id}
        data-timeline-lane={lane}
        data-timeline-row-locked={rowLocked ? "true" : undefined}
        data-timeline-overlap={overlapping ? "true" : undefined}
        data-timeline-dependency-target={dependencyTarget ? "true" : undefined}
        aria-label={barInfo}
        tabIndex={0}
        onKeyDown={(event) => {
          if (!event.altKey) return;
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          onMoveRow(event.key === "ArrowUp" ? -1 : 1);
        }}
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerEnter={onBarEnter}
        onPointerLeave={onBarLeave}
        onClick={onBarClick}
        className={`tl-bar group absolute top-[3px] flex min-w-2 cursor-grab select-none touch-none items-center gap-1.5 overflow-visible rounded-[4px] px-2 text-[12px] transition-[width,box-shadow] duration-150 active:cursor-grabbing hover:z-30 hover:shadow-[0_2px_8px_rgba(0,0,0,0.18)] ${
          collapsedMarker && milestone ? "bg-transparent shadow-none" : barFaceClass
        } ${
          active ? "z-30 shadow-lg transition-none" : "z-10"
        } ${dependencyTarget ? "ring-2 ring-[#2c60b8] ring-offset-1" : ""} ${
          overlapping ? "outline outline-2 outline-offset-1 outline-amber-400" : ""
        } ${
          dx !== 0 ? "opacity-80" : ""
        }`}
        style={{
          ...barStyle,
          ...(collapsedMarker ? { width: 8, paddingLeft: 0, paddingRight: 0 } : {}),
          ...(milestone ? { paddingLeft: 0, paddingRight: 0 } : {}),
          ...(hovered && !markerStyle ? { paddingLeft: 26 } : {}),
        }}
      >
        {rowLocked && (
          <span
            title="行を固定中"
            aria-hidden="true"
            className="pointer-events-none absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#2c60b8] opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
          />
        )}
        {!skinny && showAvatar && !milestone && task.assignee_name && (
          <TaskAvatar name={task.assignee_name} className="h-6 w-6" />
        )}
        {milestone ? (
          <>
            <TaskMilestoneIcon
              completed={task.completed}
              sizeClassName="h-4 w-4"
              className="shrink-0"
            />
            {outsideLabel}
          </>
        ) : externalLabel ? (
          <>
            {sameDay && hovered && (
              <span
                data-timeline-bar-name={task.id}
                dir="auto"
                className={`pointer-events-none min-w-0 flex-1 truncate ${task.completed ? "line-through" : ""}`}
              >
                {task.name}
              </span>
            )}
            {outsideLabel}
          </>
        ) : (
          <span
            data-timeline-bar-name={task.id}
            dir="auto"
            className={`pointer-events-none line-clamp-2 min-w-0 flex-1 leading-[14px] ${task.completed ? "line-through" : ""}`}
          >
            {task.name}
          </span>
        )}
        {!skinny && showSubtasks && !milestone && (
          <span className="pointer-events-none flex shrink-0 items-center gap-0.5 text-[11px] text-neutral-700" title="サブタスク">
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M4 3v4.5a2 2 0 0 0 2 2h6" />
              <path d="M9.5 7.5 12 9.5 9.5 11.5" />
            </svg>
            {task.subtask_count}
          </span>
        )}
      </div>

      <div
        data-timeline-handle="start"
        title="開始日を変更"
        onPointerDown={onStartDrag}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerEnter={onBarEnter}
        onPointerLeave={onBarLeave}
        onClick={(event) => event.stopPropagation()}
        className={`tl-bar absolute top-[3px] z-20 cursor-ew-resize touch-none rounded-l-[4px] bg-transparent transition-colors hover:bg-[#2c60b8]/90 ${
          collapsedMarker ? "pointer-events-none" : ""
        }`}
        style={startHandleStyle}
      />
      <div
        data-timeline-handle="end"
        title="期日を変更"
        onPointerDown={onEndDrag}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerEnter={onBarEnter}
        onPointerLeave={onBarLeave}
        onClick={(event) => event.stopPropagation()}
        className={`tl-bar absolute top-[3px] z-20 cursor-ew-resize touch-none rounded-r-[4px] bg-transparent transition-colors hover:bg-[#2c60b8]/90 ${
          collapsedMarker ? "pointer-events-none" : ""
        }`}
        style={endHandleStyle}
      />

      {!active && (
        <>
          <button
            type="button"
            data-timeline-dependency-handle={task.id}
            data-timeline-dependency-direction="precedent"
            aria-label="先行タスクとの依存関係を作成"
            title="ドラッグして依存関係を作成"
            onPointerDown={onStartDependency}
            onPointerMove={onDependencyMove}
            onPointerUp={onDependencyUp}
            onPointerEnter={onDependencyEnter}
            onPointerLeave={onDependencyLeave}
            onClick={(event) => event.stopPropagation()}
            data-timeline-dependency-placement="top"
            style={{ left: `calc(${x1} + 8px)`, top: -8 }}
            className={dependencyHandleClass(hovered)}
          >
            <span className="h-0 w-0 border-x-[3px] border-b-[4px] border-x-transparent border-b-neutral-500" />
          </button>
          <button
            type="button"
            data-timeline-dependency-handle={task.id}
            data-timeline-dependency-direction="dependent"
            aria-label="後続タスクとの依存関係を作成"
            title="ドラッグして依存関係を作成"
            onPointerDown={onEndDependency}
            onPointerMove={onDependencyMove}
            onPointerUp={onDependencyUp}
            onPointerEnter={onDependencyEnter}
            onPointerLeave={onDependencyLeave}
            onClick={(event) => event.stopPropagation()}
            data-timeline-dependency-placement="bottom"
            style={{ left: `max(calc(${x1} + 8px), calc(${x2} - 22px))`, top: 32 }}
            className={dependencyHandleClass(hovered)}
          >
            <span className="h-0 w-0 border-x-[3px] border-t-[4px] border-x-transparent border-t-neutral-500" />
          </button>
        </>
      )}

      {!active && hovered && !markerStyle && (
        <>
          <TaskCompletionToggle
            data-timeline-complete={task.id}
            completed={task.completed}
            onToggle={onToggleComplete}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerEnter={onDependencyEnter}
            onPointerLeave={onDependencyLeave}
            style={{ left: completionLeft, top: 12 }}
            className="absolute z-30 shadow-sm"
          />
          {overflow && !skinny && !sameDay && (
            <span
              data-timeline-bar-tooltip={task.id}
              role="tooltip"
              className="pointer-events-none absolute z-50 w-max max-w-[260px] whitespace-normal rounded-[4px] bg-[#333] px-3 py-2 text-[12px] leading-[18px] text-[#f3f3f3] shadow-[0_1px_4px_rgba(118,118,118,0.08)]"
              style={
                labelOnLeft
                  ? { right: `calc(100% - ${x1} + 8px)`, top: "50%", transform: "translateY(-50%)" }
                  : { left: `calc(${x2} + 8px)`, top: "50%", transform: "translateY(-50%)" }
              }
            >
              <span
                aria-hidden
                className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 rounded-[1px] bg-[#333]"
                style={labelOnLeft ? { right: -5 } : { left: -5 }}
              />
              <span dir="auto" className="relative block break-words">{task.name}</span>
              <span className="relative mt-0.5 block text-[11px] leading-4 text-neutral-300">
                {task.start_on ?? "?"} 〜 {task.due_on ?? "?"}
                {task.assignee_name ? ` ・ ${task.assignee_name}` : ""}
              </span>
            </span>
          )}
        </>
      )}

      {active && dragMode !== "move" && (
        <span
          className="pointer-events-none absolute top-0 z-30 h-10 w-px bg-[#2c60b8]"
          style={{ left: activeGuideLeft }}
        />
      )}
    </div>
  );
}

export default memo(TimelineBar);
