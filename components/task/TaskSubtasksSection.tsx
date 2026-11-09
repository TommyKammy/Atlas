"use client";

import Link from "next/link";
import { useState } from "react";
import type { TaskRow } from "@/lib/data";
import { dueSegs } from "@/lib/dates";
import TaskAvatar from "./TaskAvatar";
import TaskCompletionToggle from "./TaskCompletionToggle";
import TaskSectionHeading from "./TaskSectionHeading";

/** Subtask list and inline composer inside the task pane. */
export default function TaskSubtasksSection({
  projectId,
  view,
  subtasks,
  adding,
  draft,
  onStartAdd,
  onCancelAdd,
  onDraftChange,
  onAdd,
  onToggle,
  onDelete,
}: {
  projectId: number;
  view: string;
  subtasks: TaskRow[];
  adding: boolean;
  draft: string;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onToggle: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => void;
}) {
  const [hideDone, setHideDone] = useState(false);
  const visible = hideDone ? subtasks.filter((subtask) => !subtask.completed) : subtasks;
  const doneCount = subtasks.filter((subtask) => subtask.completed).length;

  return (
    <section className="mt-5" data-task-subtasks>
      <TaskSectionHeading
        title="サブタスク"
        count={subtasks.length}
        action={
          <>
            <button
              type="button"
              onClick={onStartAdd}
              title="サブタスクを追加"
              aria-label="サブタスクを追加"
              className="flex h-6 w-6 items-center justify-center rounded text-[16px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
            >
              ＋
            </button>
            {doneCount > 0 && (
              <button
                type="button"
                onClick={() => setHideDone((value) => !value)}
                className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${
                  hideDone
                    ? "bg-blue-50 text-blue-700"
                    : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                }`}
                title="サブタスクの絞り込み"
              >
                {hideDone ? `完了 ${doneCount} 件を表示` : "完了を隠す"}
              </button>
            )}
          </>
        }
      />

      {visible.map((subtask) => {
        const [dueLabel] = dueSegs(null, subtask.due_on);
        return (
          <div
            key={subtask.id}
            data-subtask-row={subtask.id}
            className="group/sub flex min-h-8 items-center gap-2 border-b border-neutral-100 py-1 text-[13px]"
          >
            <TaskCompletionToggle completed={subtask.completed} milestone={subtask.is_milestone} onToggle={() => onToggle(subtask)} />
            <Link
              href={`/projects/${projectId}?view=${view}&task=${subtask.id}`}
              className={`min-w-0 flex-1 truncate hover:text-blue-700 hover:underline ${
                subtask.completed ? "text-neutral-400 line-through" : "text-neutral-800"
              }`}
              title={subtask.name}
            >
              {subtask.name}
            </Link>
            {subtask.assignee_name && (
              <TaskAvatar name={subtask.assignee_name} className="h-5 w-5" textClassName="text-[9px]" />
            )}
            {dueLabel && <span className="shrink-0 text-[11px] text-neutral-500">{dueLabel}</span>}
            <button
              type="button"
              onClick={() => onDelete(subtask)}
              title="サブタスクを削除"
              aria-label={`${subtask.name} を削除`}
              className="invisible shrink-0 rounded px-1 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-red-600 group-hover/sub:visible"
            >
              ×
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="mt-1 flex gap-1.5">
          <input
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onAdd();
              if (event.key === "Escape") onCancelAdd();
            }}
            placeholder="サブタスク名を入力"
            autoFocus
            className="h-8 min-w-0 flex-1 rounded border border-neutral-300 px-2 text-[12px] outline-none focus:border-[#4075cf]"
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={!draft.trim()}
            className="shrink-0 rounded bg-[#2f6fd0] px-3 text-[12px] font-medium text-white hover:bg-[#2459ad] disabled:bg-neutral-200 disabled:text-neutral-500"
          >
            追加
          </button>
          <button
            type="button"
            onClick={onCancelAdd}
            className="shrink-0 rounded px-2 text-[11px] text-neutral-500 hover:bg-neutral-100"
          >
            キャンセル
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStartAdd}
          className="flex min-h-8 w-full items-center gap-2 rounded px-1 text-left text-[13px] text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600"
        >
          <span className="text-base leading-none">＋</span>
          <span className="min-w-0 flex-1 truncate">サブタスクを追加</span>
          <span className="flex shrink-0 items-center gap-1 text-neutral-400">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed" title="担当者">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.1">
                <circle cx="8" cy="5.5" r="2.3" />
                <path d="M3.5 13c.5-2.4 2.2-3.6 4.5-3.6s4 1.2 4.5 3.6" />
              </svg>
            </span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed" title="期日">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.1">
                <rect x="3" y="4" width="10" height="9" rx="1" />
                <path d="M5 2.5v3M11 2.5v3M3 7h10" />
              </svg>
            </span>
          </span>
        </button>
      )}
    </section>
  );
}
