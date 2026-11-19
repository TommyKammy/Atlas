"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import type { TaskRow } from "@/lib/data";
import UserAvatar from "../UserAvatar";
import TaskMilestoneIcon from "./TaskMilestoneIcon";
import { TASK_APPROVAL_STATUS_LABELS } from "@/lib/task-approval";

/** Top action bar of the task pane, aligned with Asana's task header. */
export default function TaskPaneHeader({
  task,
  collaborators,
  showTitle,
  closeHref,
  maximized,
  stateText,
  overdueDays,
  overdueText,
  onToggle,
  onRemove,
  onShare,
  onCopyLink,
  onToggleFullscreen,
  onOpenApproval,
  canEdit,
}: {
  task: TaskRow;
  collaborators: { id: number; name: string; avatar_url?: string | null }[];
  showTitle: boolean;
  closeHref: string;
  maximized: boolean;
  stateText: string;
  overdueDays: number;
  overdueText: string | null;
  onToggle: () => void;
  onRemove: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onToggleFullscreen: () => void;
  onOpenApproval: () => void;
  canEdit: boolean;
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

  const iconButtonBase =
    "h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-text";
  const iconButton = `flex ${iconButtonBase} text-muted`;
  const collaboratorTitle = collaborators.map((person) => person.name).join("・");
  const completionLabel = task.approval
    ? TASK_APPROVAL_STATUS_LABELS[task.approval.status]
    : task.completed
      ? "完了"
      : "完了にする";

  return (
    <div className="flex min-h-8 shrink-0 items-center gap-1 px-5 pt-4 md:px-[26px] md:pt-[18px]">
      <span
        data-task-state-summary
        className="shrink-0 whitespace-nowrap text-[12px] text-muted"
        title={stateText}
      >
        {stateText}
      </span>

      {overdueText && (
        <span
          data-task-overdue-badge
          data-overdue-days={overdueDays}
          className="ml-1 inline-flex shrink-0 items-center gap-1 rounded border border-danger-line px-1.5 py-0.5 text-[11px] font-medium leading-4 text-danger"
          title={`期限超過: ${overdueDays}日`}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M8 2.5 14.5 13.5h-13L8 2.5Z" strokeLinejoin="round" />
            <path d="M8 6v3.5" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r="0.65" fill="currentColor" stroke="none" />
          </svg>
          {overdueText}
        </span>
      )}

      {showTitle ? (
        <span className="ml-2 hidden min-w-0 flex-1 truncate text-[12px] text-muted @[400px]:block" title={task.name}>
          {task.name}
        </span>
      ) : (
        <span className="flex-1" />
      )}

      <button
        type="button"
        onClick={task.approval ? onOpenApproval : onToggle}
        disabled={!task.approval && !canEdit}
        title={!task.approval && !canEdit ? "変更には編集権限が必要です" : completionLabel}
        aria-label={task.approval ? "承認の操作を開く" : completionLabel}
        className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium ${
          task.completed
            ? "bg-success-strong text-on-strong hover:bg-success-strong-hover"
            : "text-secondary hover:bg-hover hover:text-text"
        }`}
      >
        {task.is_milestone ? (
          <TaskMilestoneIcon completed={task.completed} sizeClassName="h-3.5 w-3.5" />
        ) : (
          <span
            className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] ${
              task.completed ? "border-on-strong" : "border-line-strong"
            }`}
            aria-hidden="true"
          >
            {task.completed ? "✓" : ""}
          </span>
        )}
        <span className="hidden @[600px]:inline">{completionLabel}</span>
      </button>

      <div className="hidden shrink-0 items-center pl-1 @[560px]:flex" title={collaboratorTitle}>
        {collaborators.slice(0, 3).map((person, index) => (
          <span key={person.id} className={index === 0 ? "" : "-ml-1.5"}>
            <UserAvatar
              name={person.name}
              url={person.avatar_url}
              className="h-6 w-6 border-2 border-on-strong"
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
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted hover:bg-hover hover:text-text"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="6" cy="8" r="2.2" />
          <path d="M8 7.2 12 5M8 8.8 12 11" />
          <circle cx="12.5" cy="4.5" r="1.6" />
          <circle cx="12.5" cy="11.5" r="1.6" />
        </svg>
        <span className="hidden @[560px]:inline">共有</span>
      </button>

      <button
        type="button"
        onClick={() => void toggleLike()}
        aria-label={liked ? "いいねを取り消す" : "いいね"}
        aria-pressed={liked}
        title={liked ? "いいねを取り消す" : "いいね"}
        className={`flex ${iconButtonBase} ${liked ? "text-danger hover:text-danger" : "text-muted"}`}
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
        className={`hidden @[400px]:flex ${iconButtonBase} text-muted`}
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
        className={`hidden @[420px]:flex ${iconButtonBase} text-muted`}
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

      <details className="relative shrink-0">
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
        <div className="absolute right-0 top-full z-[140] mt-1 w-52 rounded-lg border border-line bg-surface p-1 text-[12px] shadow-xl">
          <button
            type="button"
            onClick={(event) => {
              closeMenu(event);
              onCopyLink();
            }}
            className="flex w-full rounded px-2.5 py-1.5 text-left text-secondary hover:bg-hover"
          >
            タスクのリンクをコピー
          </button>
          <button
            type="button"
            onClick={(event) => {
              closeMenu(event);
              onToggleFullscreen();
            }}
            className="flex w-full rounded px-2.5 py-1.5 text-left text-secondary hover:bg-hover"
          >
            {maximized ? "全画面を終了" : "フルスクリーン表示"}
          </button>
          <div className="my-1 border-t border-line-subtle" />
          <button
            type="button"
            disabled={!canEdit}
            onClick={(event) => {
              closeMenu(event);
              onRemove();
            }}
            className="flex w-full rounded px-2.5 py-1.5 text-left text-danger hover:bg-danger-soft"
          >
            タスクを削除
          </button>
        </div>
      </details>

      <Link
        href={closeHref}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
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
