"use client";

import type { MouseEvent, RefObject } from "react";
import { useState } from "react";
import MarkdownToolbar from "../MarkdownToolbar";

/** Asana-style pinned comment composer with @mentions and quick actions. */
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
  onSubmit: () => void | Promise<void>;
}) {
  const [focused, setFocused] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const insert = (text: string) => {
    const element = commentRef.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? start;
    const next = draft.slice(0, start) + text + draft.slice(end);
    onCommentChange(next, start + text.length);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const submit = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await onSubmit();
      setFocused(false);
      setEmojiOpen(false);
    } finally {
      setSending(false);
    }
  };

  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const iconButton =
    "flex h-6 w-6 items-center justify-center rounded text-[13px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800";

  return (
    <div className="shrink-0 border-t border-neutral-200 bg-white px-3 py-2.5" data-task-composer>
      <div
        className={`rounded-lg border bg-white transition-shadow ${
          focused ? "border-[#4075cf] shadow-[0_0_0_2px_rgba(64,117,207,0.12)]" : "border-neutral-300"
        }`}
      >
        {focused && (
          <div className="border-b border-neutral-100 px-2 py-1">
            <MarkdownToolbar target={commentRef} onChange={onDraftChange} />
          </div>
        )}

        {mentionOpen && mentionCandidates.length > 0 && (
          <div data-mention-menu className="mx-2 mt-1 max-h-36 overflow-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
            {mentionCandidates.map((user, index) => (
              <button
                key={user.id}
                type="button"
                data-mention-option={user.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onMentionPick(user.name);
                }}
                onMouseEnter={() => onMentionHover(index)}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] ${
                  index === mentionIndex ? "bg-blue-50" : ""
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#d8e3f3] text-[9px] font-semibold text-[#38506e]">
                  {user.name.slice(0, 1)}
                </span>
                {user.name}
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={commentRef}
          data-comment-input
          value={draft}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            if (!draft.trim()) setFocused(false);
          }}
          onChange={(event) => onCommentChange(event.target.value, event.target.selectionStart)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
              return;
            }
            if (!mentionOpen) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onMentionHover(Math.min(mentionIndex + 1, mentionCandidates.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              onMentionHover(Math.max(mentionIndex - 1, 0));
            } else if (event.key === "Enter" || event.key === "Tab") {
              const pick = mentionCandidates[mentionIndex];
              if (pick) {
                event.preventDefault();
                onMentionPick(pick.name);
              }
            } else if (event.key === "Escape") {
              onMentionClose();
            }
          }}
          placeholder="コメントを追加するか、チームメイトを @メンションします"
          rows={focused || draft ? 3 : 1}
          className="max-h-48 min-h-[34px] w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-5 outline-none placeholder:text-neutral-400"
        />

        {emojiOpen && (
          <div className="flex gap-1 px-2 pb-1">
            {["👍", "🎉", "❤️", "😄", "🙏"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onMouseDown={keepFocus}
                onClick={() => {
                  insert(emoji);
                  setEmojiOpen(false);
                }}
                className="rounded px-1 text-[16px] hover:bg-neutral-100"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-0.5 px-2 py-1.5">
          <button
            type="button"
            className={iconButton}
            title="コンテンツを追加"
            aria-label="コンテンツを追加"
            onMouseDown={keepFocus}
            onClick={() => {
              insert("/");
              setFocused(true);
            }}
          >
            ＋
          </button>
          <button
            type="button"
            className={iconButton}
            title="絵文字"
            aria-label="絵文字"
            onMouseDown={keepFocus}
            onClick={() => setEmojiOpen((value) => !value)}
          >
            ☺
          </button>
          <button
            type="button"
            className={iconButton}
            title="@メンション"
            aria-label="@メンション"
            onMouseDown={keepFocus}
            onClick={() => {
              insert("@");
              setFocused(true);
            }}
          >
            @
          </button>
          <button
            type="button"
            className={iconButton}
            title="感謝"
            aria-label="感謝"
            onMouseDown={keepFocus}
            onClick={() => insert("🙏 ありがとうございます")}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M8 13.5S2.5 10.3 2.5 6.4A2.7 2.7 0 0 1 8 4.8a2.7 2.7 0 0 1 5.5 1.6c0 3.9-5.5 7.1-5.5 7.1z" />
            </svg>
          </button>

          <span className="ml-auto text-[10px] text-neutral-400">
            {focused ? "⌘+Enter で投稿" : ""}
          </span>
          <button
            type="button"
            data-comment-submit
            aria-label="コメント"
            title="コメント"
            disabled={!draft.trim() || sending}
            onClick={() => void submit()}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#2f6fd0] text-white hover:bg-[#2459ad] disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
