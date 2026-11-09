"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { markdownToDoc } from "@/lib/rich-text-markdown";
import { emptyRichTextDoc, type MentionUser, type RichTextDoc } from "@/lib/rich-text-types";
import { toast } from "@/lib/ui-feedback";
import RichTextEditor from "../rich-text/RichTextEditor";

/** Asana-style pinned comment composer with @mentions and quick actions. */
export default function TaskCommentComposer({
  taskId,
  mentionUsers,
  onSubmit,
}: {
  taskId: number;
  mentionUsers: MentionUser[];
  onSubmit: (doc: RichTextDoc, text: string) => void | Promise<void>;
}) {
  const [editorKey, setEditorKey] = useState(0);
  const [doc, setDoc] = useState<RichTextDoc>(emptyRichTextDoc);
  const [text, setText] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [focused, setFocused] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [initialDraft, setInitialDraft] = useState<RichTextDoc | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved">("idle");
  const skipSaveRef = useRef(true);
  const mentionUsersRef = useRef(mentionUsers);

  useEffect(() => {
    mentionUsersRef.current = mentionUsers;
  }, [mentionUsers]);

  useEffect(() => {
    let cancelled = false;
    skipSaveRef.current = true;
    fetch(`/api/comment-drafts?task_id=${taskId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { draft?: { body: string; body_doc: RichTextDoc | null } } | null) => {
        if (cancelled) return;
        const draft = data?.draft;
        const nextDoc = draft
          ? (draft.body_doc ?? markdownToDoc(draft.body ?? "", mentionUsersRef.current))
          : emptyRichTextDoc();
        setInitialDraft(draft ? nextDoc : null);
        setDoc(nextDoc);
        setText(draft?.body ?? "");
        setEditorKey((value) => value + 1);
        skipSaveRef.current = true;
        setDraftReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setInitialDraft(null);
        setDraftReady(true);
        skipSaveRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  useEffect(() => {
    if (!draftReady) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    const handle = setTimeout(async () => {
      setDraftState("saving");
      try {
        if (text.trim() === "") {
          await fetch(`/api/comment-drafts?task_id=${taskId}`, { method: "DELETE" });
          setDraftState("idle");
        } else {
          const res = await fetch("/api/comment-drafts", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: taskId, body: text, body_doc: doc }),
          });
          if (!res.ok) throw new Error(`下書きの保存に失敗しました (${res.status})`);
          setDraftState("saved");
        }
      } catch {
        setDraftState("idle");
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [taskId, draftReady, doc, text]);

  const insert = (content: string) => {
    editor?.chain().focus().insertContent(content).run();
    setFocused(true);
  };

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await onSubmit(doc, text);
      await fetch(`/api/comment-drafts?task_id=${taskId}`, { method: "DELETE" }).catch(() => null);
      skipSaveRef.current = true;
      setInitialDraft(null);
      setEditorKey((value) => value + 1);
      setDoc(emptyRichTextDoc());
      setText("");
      setDraftState("idle");
      setFocused(false);
      setEmojiOpen(false);
    } catch (error) {
      toast(`コメントの投稿に失敗しました: ${error instanceof Error ? error.message : error}`);
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
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        {draftReady ? (
          <RichTextEditor
            key={editorKey}
            initialDoc={initialDraft ?? emptyRichTextDoc()}
            mentionUsers={mentionUsers}
            placeholder="コメントを追加するか、チームメイトを @メンションします"
            ariaLabel="コメント"
            dataAttributes={{ "data-comment-input": "true" }}
            minHeightClass="min-h-[34px]"
            compact
            toolbar
            borderless
            onChange={(nextDoc, nextText) => {
              setDoc(nextDoc);
              setText(nextText);
            }}
            onSubmit={submit}
            onReady={setEditor}
          />
        ) : (
          <div className="min-h-[34px] animate-pulse rounded bg-neutral-50" aria-hidden />
        )}

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
            onClick={() => insert("/")}
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
            onClick={() => insert("@")}
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
            {draftState === "saving"
              ? "下書きを保存中…"
              : draftState === "saved"
                ? "下書きを保存済み"
                : focused && text.trim()
                  ? "⌘+Enter で投稿"
                  : ""}
          </span>
          <button
            type="button"
            data-comment-submit
            aria-label="コメント"
            title="コメント"
            disabled={!text.trim() || sending}
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
