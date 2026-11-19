"use client";
import { QuickTaskName } from "../task/QuickTaskContext";

import { memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { TaskTimelineRow } from "@/lib/timeline-task-payload";
import { listRowState, LIST_ROW_STATE_LABELS } from "@/lib/list-row-state";
import { timelineBarAriaLabel } from "@/lib/timeline-display";
import { timelineInterval } from "@/lib/timeline-lanes";
import { isSingleDayTimelineTask, timelineExternalLabelShowsState, timelineStateInBar, usesTimelineExternalLabel } from "@/lib/timeline-marker";
import { timelineBarDragStyle } from "@/lib/timeline-drag-style";
import {
  TIMELINE_BAR_HEIGHT,
  TIMELINE_EDGE_HIT,
} from "@/lib/timeline-metrics";
import type { TimelineDragMode, TimelineDragState } from "@/lib/use-timeline-drag";
import DueStateIcon from "../task/DueStateIcon";
import TaskAvatar from "../task/TaskAvatar";
import TaskCompletionToggle from "../task/TaskCompletionToggle";
import TaskMilestoneIcon from "../task/TaskMilestoneIcon";
import TaskStateIcon from "../task/TaskStateIcon";

export type TimelineBarProps = {
  task: TaskTimelineRow;
  today: string;
  lane: number;
  overlapping: boolean;
  onMoveRow: (task: TaskTimelineRow, delta: number) => void;
  onMoveSection: (task: TaskTimelineRow, delta: number) => void;
  x1: string;
  x2: string;
  min: number;
  max: number;
  dayWidth: number;
  critical: boolean;
  drag: TimelineDragState | null;
  canReorder: boolean;
  hovered: boolean;
  overflow: boolean;
  dependencyTarget: boolean;
  onBarPointerDown: (event: ReactPointerEvent, task: TaskTimelineRow) => void;
  onResizeStart: (event: ReactPointerEvent, task: TaskTimelineRow, mode: TimelineDragMode) => void;
  onBarPointerMove: (event: ReactPointerEvent) => void;
  onBarPointerUp: (event: ReactPointerEvent) => void;
  onBarPointerCancel: (event: ReactPointerEvent) => void;
  onBarClick: (event: React.MouseEvent<HTMLDivElement>, taskId: number) => void;
  onBarEnter: (taskId: number) => void;
  onBarLeave: () => void;
  onDependencyStart: (event: ReactPointerEvent, task: TaskTimelineRow, edge: "start" | "end") => void;
  onDependencyCancel: (event: ReactPointerEvent) => void;
  onDependencyUp: (event: ReactPointerEvent) => void;
  onDependencyMove: (event: ReactPointerEvent) => void;
  onToggleComplete: (task: TaskTimelineRow) => void;
};

function TimelineBar({
  task,
  today,
  lane,
  overlapping,
  onMoveRow,
  onMoveSection,
  x1,
  x2,
  min,
  max,
  dayWidth,
  critical,
  drag,
  canReorder,
  hovered,
  overflow,
  dependencyTarget,
  onBarPointerDown,
  onResizeStart,
  onBarPointerMove,
  onBarPointerUp,
  onBarPointerCancel,
  onBarClick,
  onBarEnter,
  onBarLeave,
  onDependencyStart,
  onDependencyCancel,
  onDependencyUp,
  onDependencyMove,
  onToggleComplete,
}: TimelineBarProps) {
  const days = timelineInterval(task)!;
  const barPx = (Math.min(max, days.end) - Math.max(min, days.start) + 1) * dayWidth;
  const rowLocked = task.timeline_row !== null && task.timeline_row !== undefined;
  const skinny = barPx < 52;
  const sameDay = isSingleDayTimelineTask(task);
  const externalLabel = usesTimelineExternalLabel(task, barPx, dayWidth);
  const labelOnLeft = parseFloat(x1) > 72;
  const showAvatar = Boolean(task.assignee_name) && barPx >= 140;
  const showSubtasks = task.subtask_count > 0 && barPx >= 160;
  const markerStyle = sameDay || task.is_milestone;
  const stateInBar = timelineStateInBar(task, barPx);
  const stateInLabel = timelineExternalLabelShowsState(task, barPx);
  const rowState = listRowState(task, today);
  const overdue = rowState === "overdue";
  // A milestone is a diamond on the canvas, not a filled bar.
  const barFaceClass = task.is_milestone
    ? "border-transparent bg-transparent"
    : task.completed
      ? "border-line bg-surface-subtle text-muted"
      : overdue
        ? "border-danger-line bg-surface text-text"
        : "border-line-strong bg-surface text-text";
  const criticalRing = critical && !task.completed && !task.is_milestone;
  // The state circle already shows overdue. The triangle is only a fallback
  // for markers that have no circle (milestones).
  const showDueIcon = overdue && !stateInBar && !stateInLabel;
  const barInfo = timelineBarAriaLabel(task, rowState, critical);
  const barTitle = `${LIST_ROW_STATE_LABELS[rowState]}${overdue ? "・期限超過" : ""}${
    critical && !task.completed ? "・クリティカルパス上" : ""
  }`;
  const stateCue = (
    <TaskStateIcon
      state={rowState}
      sizeClassName="h-[15px] w-[15px]"
    />
  );

  const active = drag !== null;
  const dragMode = drag?.mode ?? null;
  const dx = drag?.dx ?? 0;
  const barStyle: CSSProperties = {
    height: TIMELINE_BAR_HEIGHT,
    left: x1,
    width: `calc(${x2} - ${x1})`,
    ...(drag ? timelineBarDragStyle({ ...drag, x1, x2, canReorder }) : {}),
  };
  // Short bars retain a usable center grip for vertical reordering.
  const hit = Math.min(TIMELINE_EDGE_HIT, Math.max(4, (sameDay && !hovered ? 8 : barPx) / 4));
  const handleStyle = (edge: "start" | "end"): CSSProperties => {
    const anchor = edge === "start" ? x1 : x2;
    const left = dragMode === edge || dragMode === "move" ? `calc(${anchor} + ${dx}px)` : anchor;
    return {
      height: TIMELINE_BAR_HEIGHT,
      width: hit,
      left,
      marginLeft: edge === "end" ? -hit : 0,
    };
  };
  const enterBar = () => onBarEnter(task.id);
  const completionLeft = `calc(${x1} + 4px)`;
  const collapsedMarker = markerStyle && !hovered && !active;
  const labelHidden = markerStyle && hovered;
  const completionToggle = (
    <TaskCompletionToggle
      data-timeline-complete={task.id}
      completed={task.completed}
      state={rowState}
      {...(task.approval ? { "aria-label": "承認の詳細を開く", title: "承認の詳細を開く" } : {})}
      onToggle={() => onToggleComplete(task)}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={enterBar}
      onPointerLeave={onBarLeave}
      className="shadow-sm"
    />
  );
  const outsideLabel = (
    <span
      data-timeline-bar-label={task.id}
      dir="auto"
      title={task.name}
      className={`absolute top-1/2 -translate-y-1/2 truncate text-[12px] font-medium whitespace-nowrap ${
        labelOnLeft ? "right-full mr-2 text-right" : "left-full ml-2"
      } ${task.completed ? "text-muted line-through" : "text-secondary"} ${labelHidden ? "opacity-0" : ""}`}
      style={{ maxWidth: 172 }}
    >
      {stateInLabel && (
        <TaskStateIcon state={rowState} sizeClassName="mr-1 h-3.5 w-3.5 align-[-2px]" />
      )}
      {showDueIcon && <DueStateIcon state="overdue" sizeClassName="mr-0.5 h-3.5 w-3.5 align-[-2px] text-danger" />}
      {overdue && <span className="sr-only">期限超過: </span>}
      <QuickTaskName task={task}>{task.name || "タスク名を入力"}</QuickTaskName>
    </span>
  );
  const dependencyHandleClass = (visible: boolean) =>
    `absolute z-40 flex h-3.5 w-3.5 cursor-crosshair touch-none items-center justify-center rounded-full border border-line-strong bg-surface shadow-sm hover:border-accent hover:bg-accent ${
      visible ? "opacity-100" : "pointer-events-none opacity-0"
    }`;

  return (
    <div className="relative h-10" data-timeline-row={task.id} data-timeline-lane={lane}>
      {drag?.axis && drag.mode === "move" && (
        <div
          data-timeline-drag-origin={task.id}
          aria-hidden="true"
          className="pointer-events-none absolute top-[6px] rounded-[6px] border border-dashed border-line-strong bg-surface-muted/60"
          style={{ left: x1, width: `calc(${x2} - ${x1})`, minWidth: 8, height: TIMELINE_BAR_HEIGHT }}
        />
      )}
      <div
        data-timeline-bar={task.id}
        data-timeline-bar-state={rowState}
        data-timeline-critical-task={critical ? "true" : "false"}
        data-timeline-lane={lane}
        data-timeline-row-locked={rowLocked ? "true" : undefined}
        data-timeline-overlap={overlapping ? "true" : undefined}
        data-timeline-dependency-target={dependencyTarget ? "true" : undefined}
        aria-label={barInfo}
        title={barTitle}
        tabIndex={0}
        onKeyDown={(event) => {
          if (!event.altKey) return;
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) onMoveSection(task, event.key === "ArrowUp" ? -1 : 1);
          else onMoveRow(task, event.key === "ArrowUp" ? -1 : 1);
        }}
        onPointerDown={(event) => onBarPointerDown(event, task)}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerCancel={onBarPointerCancel}
        onLostPointerCapture={onBarPointerCancel}
        onPointerEnter={enterBar}
        onPointerLeave={onBarLeave}
        onClick={(event) => onBarClick(event, task.id)}
        className={`tl-bar group absolute top-[6px] flex min-w-2 cursor-grab select-none touch-none items-center gap-1.5 overflow-visible rounded-[6px] border px-2 text-[12px] transition-[width,box-shadow] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:cursor-grabbing hover:z-30 hover:shadow-[0_2px_8px_rgba(0,0,0,0.18)] ${barFaceClass} ${
          criticalRing ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""
        } ${
          active ? "z-30 shadow-lg transition-none" : "z-10"
        } ${dependencyTarget ? "ring-2 ring-accent ring-offset-1" : ""} ${
          overlapping ? "outline outline-2 outline-offset-1 outline-warning" : ""
        } ${
          dx !== 0 ? "opacity-80" : ""
        }`}
        style={{
          ...barStyle,
          ...(collapsedMarker ? { width: 8, paddingLeft: 0, paddingRight: 0 } : {}),
          ...(task.is_milestone ? { paddingLeft: 0, paddingRight: 0 } : {}),
        }}
      >
        {rowLocked && (
          <span
            title="行を固定中"
            aria-hidden="true"
            className="pointer-events-none absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
          />
        )}
        {stateInBar && (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {hovered && !active ? completionToggle : stateCue}
          </span>
        )}
        {!skinny && showAvatar && !task.is_milestone && task.assignee_name && (
          <TaskAvatar name={task.assignee_name} className="h-5 w-5" />
        )}
        {task.is_milestone ? (
          <>
            <TaskMilestoneIcon
              completed={task.completed}
              critical={critical}
              colorClassName={task.completed ? "text-success" : critical ? "text-accent" : "text-text"}
              criticalDecoration={false}
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
                className={`pointer-events-none min-w-0 flex-1 truncate ${task.completed ? "text-muted line-through" : ""}`}
              >
                <QuickTaskName task={task}>{task.name || "タスク名を入力"}</QuickTaskName>
              </span>
            )}
            {outsideLabel}
          </>
        ) : (
          <>
            {overdue && <span className="sr-only">期限超過: </span>}
            <span
              data-timeline-bar-name={task.id}
              dir="auto"
              className={`min-w-0 flex-1 truncate text-[12px] leading-4 whitespace-nowrap ${
                task.completed ? "text-muted line-through" : ""
              }`}
            >
              <QuickTaskName task={task}>{task.name || "タスク名を入力"}</QuickTaskName>
            </span>
          </>
        )}
        {!skinny && showSubtasks && !task.is_milestone && (
          <span className="pointer-events-none shrink-0 text-[11px] text-muted" title="サブタスク">
            ⤷ {task.subtask_count}
          </span>
        )}
        {task.progress > 0 && !task.completed && !task.is_milestone && (
          <span
            data-timeline-progress={task.progress}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-bl-[5px] bg-text"
            style={{ width: `${task.progress}%` }}
          />
        )}
      </div>

      <div
        data-timeline-handle="start"
        title="開始日を変更"
        onPointerDown={(event) => onResizeStart(event, task, "start")}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerCancel={onBarPointerCancel}
        onLostPointerCapture={onBarPointerCancel}
        onPointerEnter={enterBar}
        onPointerLeave={onBarLeave}
        onClick={(event) => event.stopPropagation()}
        className={`tl-bar absolute top-[6px] z-20 cursor-ew-resize touch-none rounded-l-[6px] bg-transparent transition-colors hover:bg-accent/90 ${
          collapsedMarker ? "pointer-events-none" : ""
        }`}
        style={handleStyle("start")}
      />
      <div
        data-timeline-handle="end"
        title="期日を変更"
        onPointerDown={(event) => onResizeStart(event, task, "end")}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerCancel={onBarPointerCancel}
        onLostPointerCapture={onBarPointerCancel}
        onPointerEnter={enterBar}
        onPointerLeave={onBarLeave}
        onClick={(event) => event.stopPropagation()}
        className={`tl-bar absolute top-[6px] z-20 cursor-ew-resize touch-none rounded-r-[6px] bg-transparent transition-colors hover:bg-accent/90 ${
          collapsedMarker ? "pointer-events-none" : ""
        }`}
        style={handleStyle("end")}
      />

      {!active && (
        <>
          <button
            type="button"
            data-timeline-dependency-handle={task.id}
            data-timeline-dependency-direction="precedent"
            aria-label="先行タスクとの依存関係を作成"
            title="ドラッグして依存関係を作成"
            onPointerDown={(event) => onDependencyStart(event, task, "start")}
            onPointerMove={onDependencyMove}
            onPointerUp={onDependencyUp}
            onPointerCancel={onDependencyCancel}
            onLostPointerCapture={onDependencyCancel}
            onPointerEnter={enterBar}
            onPointerLeave={onBarLeave}
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
            onPointerDown={(event) => onDependencyStart(event, task, "end")}
            onPointerMove={onDependencyMove}
            onPointerUp={onDependencyUp}
            onPointerCancel={onDependencyCancel}
            onLostPointerCapture={onDependencyCancel}
            onPointerEnter={enterBar}
            onPointerLeave={onBarLeave}
            onClick={(event) => event.stopPropagation()}
            data-timeline-dependency-placement="bottom"
            style={{ left: `max(calc(${x1} + 8px), calc(${x2} - 22px))`, top: 32 }}
            className={dependencyHandleClass(hovered)}
          >
            <span className="h-0 w-0 border-x-[3px] border-t-[4px] border-x-transparent border-t-neutral-500" />
          </button>
        </>
      )}

      {!active && hovered && !markerStyle && !stateInBar && (
        <TaskCompletionToggle
          data-timeline-complete={task.id}
          completed={task.completed}
          state={rowState}
          {...(task.approval ? { "aria-label": "承認の詳細を開く", title: "承認の詳細を開く" } : {})}
          onToggle={() => onToggleComplete(task)}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={enterBar}
          onPointerLeave={onBarLeave}
          style={{ left: completionLeft, top: 12 }}
          className="absolute z-30 shadow-sm"
        />
      )}

      {!active && hovered && overflow && !skinny && !sameDay && (
        <span
          data-timeline-bar-tooltip={task.id}
          role="tooltip"
          className="pointer-events-none absolute z-50 w-max max-w-[260px] whitespace-normal rounded-[4px] bg-inverse-surface-muted px-3 py-2 text-[12px] leading-[18px] text-inverse-text-strong shadow-[0_1px_4px_rgba(118,118,118,0.08)]"
          style={
            labelOnLeft
              ? { right: `calc(100% - ${x1} + 8px)`, top: "50%", transform: "translateY(-50%)" }
              : { left: `calc(${x2} + 8px)`, top: "50%", transform: "translateY(-50%)" }
          }
        >
          <span
            aria-hidden
            className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 rounded-[1px] bg-inverse-surface-muted"
            style={labelOnLeft ? { right: -5 } : { left: -5 }}
          />
          <span dir="auto" className="relative block break-words">{task.name}</span>
          <span className="relative mt-0.5 block text-[11px] leading-4 text-subtle">
            {task.start_on ?? "?"} 〜 {task.due_on ?? "?"}
            {task.assignee_name ? ` ・ ${task.assignee_name}` : ""}
          </span>
        </span>
      )}

      {dragMode !== null && dragMode !== "move" && (
        <span
          className="pointer-events-none absolute top-0 z-30 h-10 w-px bg-accent"
          style={{ left: handleStyle(dragMode).left }}
        />
      )}
    </div>
  );
}

export default memo(TimelineBar);
