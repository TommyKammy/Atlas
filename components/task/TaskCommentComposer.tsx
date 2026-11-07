"use client";

import type { RefObject } from "react";
import MarkdownToolbar from "../MarkdownToolbar";

/** Comment composer with @mention menu in the task pane. */
export default function TaskCommentComposer({
  commentRef,
  draft,
  onDraftChange,
  onCommentChange,
  mentionOpen,
  mentionCandidates,
  mentionIndex,
  onMentionHover,
  onMentionPick,
  onMentionClose,
  onSubmit,
}: {
  commentRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  onCommentChange: (value: string, cursor: number | null) => void;
  mentionOpen: boolean;
  mentionCandidates: { id: number; name: string }[];
  mentionIndex: number;
  onMentionHover: (index: number) => void;
  onMentionPick: (name: string) => void;
  onMentionClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border p-2">
      <div className="mb-1">
        <MarkdownToolbar target={commentRef} onChange={onDraftChange} />
      </div>
      {mentionOpen && mentionCandidates.length > 0 && (
        <div data-mention-menu className="mb-1 max-h-32 overflow-auto rounded border bg-white shadow">
          {mentionCandidates.map((u, i) => (
            <button
              key={u.id}
              type="button"
              data-mention-option={u.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onMentionPick(u.name);
              }}
              onMouseEnter={() => onMentionHover(i)}
              className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                i === mentionIndex ? "bg-blue-50" : ""
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-400 text-[10px] font-bold text-neutral-900">
                {u.name.slice(0, 1)}
              </span>
              {u.name}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={commentRef}
        data-comment-input
        value={draft}
        onChange={(e) => onCommentChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (!mentionOpen) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onMentionHover(Math.min(mentionIndex + 1, mentionCandidates.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onMentionHover(Math.max(mentionIndex - 1, 0));
          } else if (e.key === "Enter" || e.key === "Tab") {
            const pick = mentionCandidates[mentionIndex];
            if (pick) {
              e.preventDefault();
              onMentionPick(pick.name);
            }
          } else if (e.key === "Escape") {
            onMentionClose();
          }
        }}
        placeholder="コメントを追加するか、チームメイトを @メンションします"
        rows={2}
        className="w-full text-sm outline-none"
      />
      <div className="text-right">
        <button
          onClick={onSubmit}
          data-comment-submit
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
        >
          投稿
        </button>
      </div>
    </div>
  );
}
