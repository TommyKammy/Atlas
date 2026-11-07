"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import type { TaskRow } from "@/lib/data";
import UserAvatar from "../UserAvatar";

/** Top action bar of the task pane, aligned with Asana's task header. */
export default function TaskPaneHeader({
  task,
  collaborators,
  showTitle,
  closeHref,
  maximized,
  onToggle,
  onRemove,
  onShare,
  onCopyLink,
  onToggleFullscreen,
}: {
  task: TaskRow;
  collaborators: { id: number; name: string; avatar_url?: string | null }[];
  showTitle: boolean;
  closeHref: string;
  maximized: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onToggleFullscreen: () => void;
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

  const closeMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

  const iconButton =
    "flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800";
  const collaboratorTitle = collaborators.map((person) => person.name).join("・");

  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2.5">
      <button
        type="button"
        onClick={onToggle}
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium ${
          task.completed
            ? "border-green-700 bg-green-700 text-white hover:bg-green-800"
            : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
        }`}
      >
        <span
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] ${
            task.completed ? "border-white" : "border-neutral-400"
          }`}
        >
          {task.completed ? "✓" : ""}
        </span>
        {task.completed ? "完了" : "完了にする"}
      </button>

      {showTitle ? (
        <span className="ml-1 hidden min-w-0 flex-1 truncate text-[12px] text-neutral-600 md:block" title={task.name}>
          {task.name}
        </span>
      ) : (
        <span className="flex-1" />
      )}

      <div className="hidden items-center pl-1 sm:flex" title={collaboratorTitle}>
        {collaborators.slice(0, 3).map((person, index) => (
          <span key={person.id} className={index === 0 ? "" : "-ml-1.5"}>
            <UserAvatar
              name={person.name}
              url={person.avatar_url}
              className="h-6 w-6 border-2 border-white"
              textClassName="text-[9px]"
            />
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onShare}
        title="共有"
        aria-label="共有"
        className="flex h-7 items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="6" cy="8" r="2.2" />
          <path d="M8 7.2 12 5M8 8.8 12 11" />
          <circle cx="12.5" cy="4.5" r="1.6" />
          <circle cx="12.5" cy="11.5" r="1.6" />
        </svg>
        <span className="hidden lg:inline">共有</span>
      </button>

      <button
        type="button"
        onClick={() => void toggleLike()}
        aria-label={liked ? "いいねを取り消す" : "いいね"}
        aria-pressed={liked}
        title={liked ? "いいねを取り消す" : "いいね"}
        className={`${iconButton} ${liked ? "text-rose-500 hover:text-rose-600" : ""}`}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3">
          <path d="M8 13.2S2.5 10 2.5 6.1A2.8 2.8 0 0 1 8 4.4a2.8 2.8 0 0 1 5.5 1.7C13.5 10 8 13.2 8 13.2z" />
        </svg>
        {likeCount > 0 && <span className="ml-0.5 text-[10px] font-medium">{likeCount}</span>}
      </button>

      <button
        type="button"
        onClick={onCopyLink}
        title="タスクのリンクをコピー"
        aria-label="タスクのリンクをコピー"
        className={iconButton}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M6.4 9.6 9.6 6.4M6.9 4.4l1.2-1.2a2.4 2.4 0 0 1 3.4 3.4L10.3 7.8M9.1 11.6l-1.2 1.2a2.4 2.4 0 0 1-3.4-3.4L5.7 8.2" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onToggleFullscreen}
        title={maximized ? "全画面を終了" : "フルスクリーン"}
        aria-label={maximized ? "全画面を終了" : "フルスクリーン"}
        className={iconButton}
      >
        {maximized ? (
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
          </svg>
        )}
      </button>

      <details className="relative">
        <summary
          aria-label="このタスクの他のアクション"
          title="このタスクの他のアクション"
          className={`${iconButton} list-none cursor-pointer [&::-webkit-details-marker]:hidden`}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <circle cx="3" cy="8" r="1.1" />
            <circle cx="8" cy="8" r="1.1" />
            <circle cx="13" cy="8" r="1.1" />
          </svg>
        </summary>
        <div className="absolute right-0 top-full z-[140] mt-1 w-52 rounded-lg border border-neutral-200 bg-white p-1 text-[12px] shadow-xl">
          <button
            type="button"
            onClick={(event) => {
              closeMenu(event);
              onCopyLink();
            }}
            className="flex w-full rounded px-2.5 py-1.5 text-left text-neutral-700 hover:bg-neutral-100"
          >
            タスクのリンクをコピー
          </button>
          <button
            type="button"
            onClick={(event) => {
              closeMenu(event);
              onToggleFullscreen();
            }}
            className="flex w-full rounded px-2.5 py-1.5 text-left text-neutral-700 hover:bg-neutral-100"
          >
            {maximized ? "全画面を終了" : "フルスクリーン表示"}
          </button>
          <div className="my-1 border-t border-neutral-100" />
          <button
            type="button"
            onClick={(event) => {
              closeMenu(event);
              onRemove();
            }}
            className="flex w-full rounded px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50"
          >
            タスクを削除
          </button>
        </div>
      </details>

      <Link
        href={closeHref}
        className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        title="詳細を閉じる"
        aria-label="詳細を閉じる"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 3l10 10M13 3 3 13" />
        </svg>
      </Link>
    </div>
  );
}
