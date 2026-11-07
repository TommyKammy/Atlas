"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(task.like_count ?? 0);

  useEffect(() => {
    let active = true;
    fetch(`/api/tasks/${task.id}/like`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { count?: number; liked?: boolean } | null) => {
        if (!active || !data) return;
        setLiked(data.liked === true);
        setLikeCount(Number(data.count ?? 0));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [task.id]);

  const toggleLike = async () => {
    const res = await fetch(`/api/tasks/${task.id}/like`, { method: "POST" });
    if (!res.ok) return;
    const data = (await res.json()) as { count?: number; liked?: boolean };
    setLiked(data.liked === true);
    setLikeCount(Number(data.count ?? 0));
  };

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
      <button
        type="button"
        onClick={() => void toggleLike()}
        aria-label={liked ? "いいねを取り消す" : "いいね"}
        aria-pressed={liked}
        title={liked ? "いいねを取り消す" : "いいね"}
        className={`flex items-center gap-1 px-1.5 text-lg leading-none ${
          liked ? "text-rose-500" : "text-neutral-500 hover:text-rose-500"
        }`}
      >
        {liked ? "♥" : "♡"}
        {likeCount > 0 && <span className="text-[11px] font-medium">{likeCount}</span>}
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
