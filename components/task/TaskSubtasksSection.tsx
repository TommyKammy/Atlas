"use client";

import Link from "next/link";
import type { TaskRow } from "@/lib/data";
import TaskCompletionToggle from "./TaskCompletionToggle";

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
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center gap-1 text-sm text-neutral-500">
        サブタスク（{subtasks.length}）
        <button
          onClick={onStartAdd}
          title="サブタスクを追加"
          className="rounded px-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ＋
        </button>
      </div>
      {subtasks.map((s) => (
        <div key={s.id} className="group/sub flex items-center gap-2 border-b py-1 text-sm">
          <TaskCompletionToggle completed={s.completed} onToggle={() => onToggle(s)} />
          <Link
            href={`/projects/${projectId}?view=${view}&task=${s.id}`}
            className={`min-w-0 flex-1 truncate hover:underline ${s.completed ? "text-neutral-500 line-through" : ""}`}
          >
            {s.name}
          </Link>
          <button
            onClick={() => onDelete(s)}
            title="サブタスクを削除"
            className="invisible shrink-0 text-neutral-500 hover:text-red-600 group-hover/sub:visible"
          >
            ×
          </button>
        </div>
      ))}
      {adding ? (
        <div className="mt-1 flex gap-2">
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
              if (e.key === "Escape") onCancelAdd();
            }}
            onBlur={() => {
              if (draft.trim() === "") onCancelAdd();
            }}
            placeholder="サブタスク名を入力"
            autoFocus
            className="w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={onAdd}
            className="shrink-0 rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            追加
          </button>
        </div>
      ) : (
        <button
          onClick={onStartAdd}
          className="mt-1 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm text-neutral-500 hover:bg-neutral-50 hover:text-neutral-600"
        >
          <span className="min-w-0 flex-1 truncate">サブタスクを追加</span>
          <span className="flex shrink-0 items-center gap-1 text-neutral-500">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed">👤</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed">📅</span>
          </span>
        </button>
      )}
    </div>
  );
}
