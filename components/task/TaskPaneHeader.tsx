"use client";

import Link from "next/link";
import type { TaskRow } from "@/lib/data";

/** Top action bar of the task pane. */
export default function TaskPaneHeader({
  task,
  collaborators,
  closeHref,
  onToggle,
  onRemove,
}: {
  task: TaskRow;
  collaborators: string;
  closeHref: string;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <button
        onClick={onToggle}
        className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm ${
          task.completed
            ? "border-green-700 bg-green-700 text-white"
            : "border-neutral-300 hover:border-green-600"
        }`}
      >
        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] ${task.completed ? "border-white" : "border-neutral-400"}`}>
          {task.completed ? "✓" : ""}
        </span>
        {task.completed ? "完了" : "完了にする"}
      </button>
      <span className="ml-1 hidden min-w-0 flex-1 truncate text-xs text-neutral-500 lg:block" title={collaborators}>
        {collaborators}
      </span>
      <span className="flex-1 lg:hidden" />
      <button title="いいね（v1では無効）" className="cursor-default px-1.5 text-lg leading-none text-neutral-500">
        ♡
      </button>
      <button onClick={onRemove} title="削除" className="px-2 text-sm text-neutral-500 hover:text-red-600">
        削除
      </button>
      <Link href={closeHref} className="px-1.5 text-neutral-500 hover:text-black" title="閉じる" aria-label="タスクペインを閉じる">
        ×
      </Link>
    </div>
  );
}
