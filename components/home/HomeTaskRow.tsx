"use client";

import Link from "next/link";
import type { HomeTask } from "@/lib/home-widgets";

/** Compact task row used by the My tasks and Assigned tasks widgets. */
export default function HomeTaskRow({
  task,
  bucket,
  today,
  showProject = true,
  busy = false,
  onToggle,
}: {
  task: HomeTask;
  bucket: string;
  today: string;
  showProject?: boolean;
  busy?: boolean;
  onToggle: (task: HomeTask) => void;
}) {
  const overdue = task.due_on !== null && task.due_on < today && !task.completed;
  return (
    <div
      data-home-task-row={task.id}
      data-home-task-bucket={bucket}
      className="group flex items-center gap-2 border-b border-neutral-100 px-4 py-2 text-[13px] last:border-b-0 hover:bg-neutral-50"
    >
      <button
        type="button"
        data-home-task-toggle={task.id}
        aria-label={task.completed ? "未完了に戻す" : "完了にする"}
        disabled={busy}
        onClick={() => onToggle(task)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          task.completed
            ? "border-green-600 bg-green-600 text-[11px] text-white"
            : "border-neutral-400 hover:border-green-600"
        } disabled:opacity-50`}
      >
        {task.completed ? "✓" : ""}
      </button>
      <Link
        href={`/projects/${task.project_id}?view=list&task=${task.id}`}
        className={`min-w-0 flex-1 truncate hover:underline ${task.completed ? "text-subtle line-through" : ""}`}
        title={task.name}
      >
        {task.name}
      </Link>
      {showProject && (
        <span className="hidden max-w-[130px] shrink-0 truncate text-[11px] text-subtle sm:inline">
          {task.project_name ?? "–"}
        </span>
      )}
      <span
        className={`w-[76px] shrink-0 text-right text-[11px] ${
          overdue ? "font-semibold text-danger" : "text-muted"
        }`}
      >
        {task.due_on ?? "–"}
      </span>
    </div>
  );
}
