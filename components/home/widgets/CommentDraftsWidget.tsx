"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDateTime, plainTextSnippet } from "@/lib/dates";
import type { HomeCommentDraft } from "@/lib/home-widgets";
import { confirmAction, toast } from "@/lib/ui-feedback";

/** Unfinished comments saved by the task composer. */
export default function CommentDraftsWidget({ drafts }: { drafts: HomeCommentDraft[] }) {
  const router = useRouter();
  const [deleted, setDeleted] = useState<number[]>([]);
  const visible = drafts.filter((draft) => !deleted.includes(draft.task_id));

  const discard = async (draft: HomeCommentDraft) => {
    if (!(await confirmAction(`「${draft.task_name}」のコメント下書きを削除しますか？`))) return;
    try {
      await fetch(`/api/comment-drafts?task_id=${draft.task_id}`, { method: "DELETE" });
      setDeleted((current) => [...current, draft.task_id]);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "下書きの削除に失敗しました");
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-1.5">
        <span className="text-[11px] text-subtle">書きかけのコメント</span>
        <span className="flex-1" />
        <span className="text-[11px] text-subtle">{visible.length}件</span>
      </div>

      <div className="min-h-[170px] flex-1">
        {visible.length === 0 ? (
          <div className="flex h-full min-h-[170px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-subtle">
              ✎
            </span>
            <p className="text-[12px] text-muted">コメントの下書きはありません。</p>
            <p className="text-[11px] text-muted">
              タスクのコメント入力中は自動で保存されます。
            </p>
          </div>
        ) : (
          visible.slice(0, 6).map((draft) => (
            <div
              key={draft.task_id}
              data-home-draft-row={draft.task_id}
              className="flex min-w-0 items-start gap-2 border-b border-line-subtle px-4 py-2.5 last:border-b-0 hover:bg-hover"
            >
              <Link
                href={`/projects/${draft.project_id}?view=list&task=${draft.task_id}`}
                className="min-w-0 flex-1"
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-text">
                    {draft.task_name}
                  </span>
                  <span className="shrink-0 text-[10px] text-subtle">
                    {formatDateTime(draft.updated_at)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-secondary">
                  {plainTextSnippet(draft.body, 100) || "（空の下書き）"}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-subtle">
                  {draft.project_name}
                </span>
              </Link>
              <button
                type="button"
                data-home-draft-discard={draft.task_id}
                aria-label="下書きを削除"
                title="下書きを削除"
                onClick={() => void discard(draft)}
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px] text-subtle hover:bg-danger-soft hover:text-danger"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-line-subtle px-4 py-1.5 text-right text-[11px] text-subtle">
        コメントを投稿すると下書きは削除されます
      </div>
    </>
  );
}
