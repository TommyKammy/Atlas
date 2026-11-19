"use client";
import { QuickTaskName } from "../task/QuickTaskContext";

import Link from "next/link";
import type { DragEvent, MouseEvent } from "react";
import type { TaskRow } from "@/lib/data";
import { dueSegs } from "@/lib/dates";
import { listRowState } from "@/lib/list-row-state";
import { taskSectionId } from "@/lib/task-section";
import type { BoardCardFields } from "./BoardToolbar";
import TaskCompletionToggle from "../task/TaskCompletionToggle";
import DueStateIcon from "../task/DueStateIcon";
import TaskAvatar from "../task/TaskAvatar";
import TaskStatusChip from "../task/TaskStatusChip";
import TaskApprovalBadge from "../task/TaskApprovalBadge";

/**
 * One board card. Kept separate from BoardView so column layout, drag
 * bookkeeping and card presentation can evolve independently.
 *
 * The card follows the workbench mockup: a surface with a line border, 12px
 * padding and 10px between rows. The completion circle and name lead, progress
 * sits between the name and the meta row, and the bottom row pairs the
 * assignee/meta with the due date. Status-like badges move to a quiet row above
 * the name so the card keeps one reading order.
 */
export default function BoardCard({
  task,
  projectId,
  canDragCards,
  effectiveGroupBy,
  sectionName,
  cardFields,
  statusFieldEnabled,
  today,
  onDragStart,
  onDragEnd,
  onClick,
  onToggleComplete,
  onMove,
}: {
  task: TaskRow;
  projectId: number;
  canDragCards: boolean;
  effectiveGroupBy: string;
  sectionName: Map<number, string>;
  cardFields: BoardCardFields;
  statusFieldEnabled: boolean;
  today: string;
  onDragStart: (event: DragEvent<HTMLDivElement>, taskId: number) => void;
  onDragEnd: () => void;
  onClick: (event: MouseEvent<HTMLDivElement>, taskId: number) => void;
  onToggleComplete: () => void;
  onMove: (delta: 1 | -1) => void;
}) {
  const sectionId = taskSectionId(task);
  const overdue = !task.completed && task.due_on !== null && task.due_on < today;
  const rowState = listRowState(task, today);
  const showProgress = task.progress > 0 && !task.completed;
  const showSection = effectiveGroupBy !== "section" && sectionId !== null;
  const showStatus = cardFields.status && statusFieldEnabled && task.status !== "inbox";
  const showBadges = Boolean(task.approval) || showSection || showStatus;
  const showMeta = cardFields.meta && (task.subtask_count > 0 || task.comment_count > 0);
  const metaTitle = [
    task.subtask_count > 0 ? `子タスク ${task.subtask_count}` : null,
    task.comment_count > 0 ? `コメント ${task.comment_count}` : null,
  ].filter((part): part is string => part !== null).join(" ・ ");
  return (
    <div
      data-board-card={task.id}
      data-board-assignee={task.assignee_name ?? ""}
      data-board-due={task.due_on ?? ""}
      data-board-status={task.status}
      data-board-subtask-count={task.subtask_count ?? 0}
      data-board-comment-count={task.comment_count ?? 0}
      draggable={canDragCards}
      onDragStart={(event) => {
        if (!canDragCards) return;
        onDragStart(event, task.id);
      }}
      onDragEnd={onDragEnd}
      onClick={(event) => onClick(event, task.id)}
      className="flex cursor-pointer flex-col gap-2.5 rounded-lg border border-line bg-surface p-3 text-sm transition-colors hover:border-line-strong active:cursor-grabbing"
    >
      {showBadges && (
        <div
          data-board-card-badges
          className="flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-muted"
        >
          {showSection && sectionId !== null && (
            <span data-board-section-pill className="max-w-full truncate rounded border border-line px-1.5 py-0.5">
              {sectionName.get(sectionId) ?? ""}
            </span>
          )}
          {showStatus && <TaskStatusChip status={task.status} compact />}
          {task.approval && (
            <TaskApprovalBadge
              approval={task.approval}
              href={`/projects/${projectId}?view=board&task=${task.id}&approval=1`}
            />
          )}
        </div>
      )}
      <div className="flex items-start gap-2">
        <TaskCompletionToggle
          completed={task.completed}
          milestone={task.is_milestone}
          state={rowState}
          onToggle={onToggleComplete}
          disabled={Boolean(task.approval)}
          title={task.approval ? "承認の状態はタスク詳細から変更してください" : undefined}
          {...(task.approval ? { "aria-label": "承認タスクの完了は承認操作から行います" } : {})}
          className="mt-0.5"
        />
        <QuickTaskName task={task}><Link
          href={`/projects/${projectId}?view=board&task=${task.id}`}
          title={task.name}
          dir="auto"
          className={`line-clamp-2 min-w-0 flex-1 break-words font-medium ${task.completed ? "text-muted line-through" : ""}`}
        >
          {task.name || "タスク名を入力"}
        </Link></QuickTaskName>
      </div>
      {showProgress && (
        <div
          data-board-progress={task.progress}
          role="progressbar"
          aria-label="進捗"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={task.progress}
          className="h-[3px] rounded-[2px] bg-surface-muted"
        >
          <div className="h-full rounded-[2px] bg-text" style={{ width: `${task.progress}%` }} />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          {cardFields.assignee && (task.assignee_name ? (
            <span className="flex min-w-0 items-center gap-1">
              <TaskAvatar name={task.assignee_name} className="h-4 w-4" textClassName="text-[9px]" />
              <span className="truncate">{task.assignee_name}</span>
            </span>
          ) : (
            <span>未割当</span>
          ))}
          {showMeta && (
            <span className="whitespace-nowrap" title={metaTitle}>
              {task.subtask_count > 0 && (
                <span data-board-subtask-badge>子タスク {task.subtask_count}</span>
              )}
              {task.subtask_count > 0 && task.comment_count > 0 && " ・ "}
              {task.comment_count > 0 && (
                <span data-board-comment-badge>コメント {task.comment_count}</span>
              )}
            </span>
          )}
        </div>
        {cardFields.due &&
          (task.start_on || task.due_on) &&
          (() => {
            const [s1, s2] = dueSegs(task.start_on, task.due_on);
            const dueLabel = s2 ? `${s1} – ${s2}` : s1;
            return (
              <span
                data-board-due-label
                className={`shrink-0 whitespace-nowrap ${overdue ? "font-medium text-danger" : ""}`}
                title={overdue ? `期限超過: ${dueLabel}` : undefined}
              >
                {overdue && <DueStateIcon state="overdue" className="mr-0.5 align-[-2px]" />}
                {overdue && <span className="sr-only">期限超過: </span>}
                {s1}
                {s2 && <span className="whitespace-nowrap"> – {s2}</span>}
              </span>
            );
          })()}
      </div>
      <div className="flex gap-1 md:hidden">
        <button
          type="button"
          onClick={() => onMove(-1)}
          className="rounded-md border border-line px-2 py-0.5 text-xs text-secondary hover:bg-hover"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          className="rounded-md border border-line px-2 py-0.5 text-xs text-secondary hover:bg-hover"
        >
          →
        </button>
      </div>
    </div>
  );
}
