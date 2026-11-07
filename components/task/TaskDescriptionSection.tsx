"use client";

import { useRef, useState } from "react";
import type { FocusEvent } from "react";
import { renderMarkdown } from "@/lib/markdown";
import MarkdownToolbar from "../MarkdownToolbar";

/**
 * Asana-style description block. The empty state is always visible so the
 * description field cannot be mistaken for missing UI.
 */
export default function TaskDescriptionSection({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };

  const save = () => {
    onSave(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  return (
    <section className="mt-5" data-task-description>
      <div className="mb-1 flex min-h-8 items-center gap-2">
        <h3 className="text-[12px] font-semibold text-neutral-700">説明</h3>
        {!editing && value && (
          <button
            type="button"
            onClick={start}
            className="rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
          >
            編集
          </button>
        )}
      </div>

      {editing ? (
        <div
          className="rounded-lg border border-neutral-300 bg-white focus-within:border-[#4075cf] focus-within:ring-2 focus-within:ring-[#4075cf]/10"
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) save();
          }}
        >
          <div className="border-b border-neutral-100 px-2 py-1.5">
            <MarkdownToolbar target={ref} onChange={setDraft} />
          </div>
          <textarea
            ref={ref}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                save();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            rows={5}
            autoFocus
            data-task-description-input
            placeholder="このタスクの内容を入力します"
            className="min-h-[120px] w-full resize-y bg-transparent px-3 py-2 text-[13px] leading-6 outline-none placeholder:text-neutral-400"
          />
          <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-2 py-1.5">
            <span className="text-[10px] text-neutral-400">Markdown / ⌘+Enter で保存</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={cancel}
                className="rounded px-2.5 py-1 text-[12px] text-neutral-600 hover:bg-neutral-100"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={save}
                className="rounded bg-[#2f6fd0] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#2459ad]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : value ? (
        <div
          onClick={(event) => {
            if ((event.target as Element).closest("a")) return;
            start();
          }}
          title="クリックして編集"
          className="min-h-[96px] cursor-text rounded-lg px-2 py-2 text-[13px] leading-6 text-neutral-700 hover:bg-neutral-50 [&_a]:text-blue-700 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-semibold [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
        />
      ) : (
        <button
          type="button"
          onClick={start}
          className="min-h-[132px] w-full rounded-lg px-2 py-2 text-left text-[13px] text-neutral-400 hover:bg-neutral-50 hover:text-neutral-500"
        >
          このタスクの内容を入力します
        </button>
      )}
    </section>
  );
}
