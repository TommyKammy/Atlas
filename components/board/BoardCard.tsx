"use client";
import { QuickTaskName } from "../task/QuickTaskContext";

import Link from "next/link";
import type { DragEvent, MouseEvent } from "react";
import type { TaskRow } from "@/lib/data";
import { dueSegs } from "@/lib/dates";
import { taskSectionId } from "@/lib/task-section";
import type { BoardCardFields } from "./BoardToolbar";
import TaskCompletionToggle from "../task/TaskCompletionToggle";
import TaskAvatar from "../task/TaskAvatar";
import TaskStatusChip from "../task/TaskStatusChip";
import TaskMetaBadges from "../task/TaskMetaBadges";
import TaskApprovalBadge from "../task/TaskApprovalBadge";

/**
 * One board card. Kept separate from BoardView so column layout, drag
 * bookkeeping and card presentation can evolve independently.
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
      className="cursor-pointer rounded-lg border border-line bg-surface p-2 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <TaskCompletionToggle
          completed={task.completed}
          milestone={task.is_milestone}
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
          className={`line-clamp-2 break-words ${task.completed ? "text-muted line-through" : ""}`}
        >
          {task.name || "タスク名を入力"}
        </Link></QuickTaskName>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        {task.approval && <TaskApprovalBadge approval={task.approval} href={`/projects/${projectId}?view=board&task=${task.id}&approval=1`} />}
        {effectiveGroupBy !== "section" && sectionId !== null && (
          <span className="rounded bg-surface-strong px-1.5 py-0.5">
            {sectionName.get(sectionId) ?? ""}
          </span>
        )}
        {cardFields.assignee && task.assignee_name && (
          <span className="flex items-center gap-1">
            <TaskAvatar name={task.assignee_name} />
            {task.assignee_name}
          </span>
        )}
        {cardFields.due &&
          (task.start_on || task.due_on) &&
          (() => {
            const [s1, s2] = dueSegs(task.start_on, task.due_on);
            return (
              <span
                className={`rounded-full px-1.5 py-0.5 ${
                  !task.completed && task.due_on !== null && task.due_on < today
                    ? "bg-red-100 font-semibold text-red-700"
                    : "bg-surface-muted text-neutral-700"
                }`}
              >
                <span className="whitespace-nowrap">{s1}</span>
                {s2 && <span className="whitespace-nowrap"> – {s2}</span>}
              </span>
            );
          })()}
        {cardFields.status && statusFieldEnabled && task.status !== "inbox" && (
          <TaskStatusChip status={task.status} compact />
        )}
        {cardFields.meta && (
          <TaskMetaBadges
            subtaskCount={task.subtask_count}
            commentCount={task.comment_count}
            dataScope="board"
          />
        )}
      </div>
      <div className="mt-1 flex gap-1 md:hidden">
        <button onClick={() => onMove(-1)} className="rounded border px-2 py-0.5 text-xs">
          ←
        </button>
        <button onClick={() => onMove(1)} className="rounded border px-2 py-0.5 text-xs">
          →
        </button>
      </div>
    </div>
  );
}
