"use client";

import { useRef, useState } from "react";
import type { FocusEvent } from "react";
import { docToText, markdownToDoc } from "@/lib/rich-text-markdown";
import type { MentionUser, RichTextDoc } from "@/lib/rich-text-types";
import { toast } from "@/lib/ui-feedback";
import RichTextEditor from "../rich-text/RichTextEditor";
import RichTextView from "../rich-text/RichTextView";

/**
 * Asana-style description block. The empty state is always visible so the
 * description field cannot be mistaken for missing UI.
 */
export default function TaskDescriptionSection({
  doc,
  legacy,
  mentionUsers,
  onSave,
}: {
  doc: RichTextDoc | null;
  legacy: string;
  mentionUsers: MentionUser[];
  onSave: (doc: RichTextDoc) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const initial = doc ?? markdownToDoc(legacy, mentionUsers);
  const draftRef = useRef<RichTextDoc>(initial);
  const hasText = docToText(initial).length > 0;

  const start = () => {
    draftRef.current = doc ?? markdownToDoc(legacy, mentionUsers);
    setEditing(true);
  };

  const save = async () => {
    try {
      await onSave(draftRef.current);
      setEditing(false);
    } catch (error) {
      toast(`説明の保存に失敗しました: ${error instanceof Error ? error.message : error}`);
    }
  };

  const cancel = () => {
    setEditing(false);
  };

  return (
    <section className="mt-5" data-task-description>
      <div className="mb-1 flex min-h-8 items-center gap-2">
        <h3 className="text-[12px] font-semibold text-neutral-700">説明</h3>
        {!editing && hasText && (
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
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void save();
          }}
        >
          <RichTextEditor
            initialDoc={doc ?? markdownToDoc(legacy, mentionUsers)}
            mentionUsers={mentionUsers}
            placeholder="このタスクの内容を入力します"
            ariaLabel="説明"
            dataAttributes={{ "data-task-description-input": "true" }}
            autoFocus
            minHeightClass="min-h-[140px]"
            onChange={(next) => {
              draftRef.current = next;
            }}
            onSubmit={() => void save()}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] text-neutral-400">⌘+Enter で保存</span>
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
                onClick={() => void save()}
                className="rounded bg-[#2f6fd0] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#2459ad]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : hasText ? (
        <div
          onClick={(event) => {
            if ((event.target as Element).closest("a")) return;
            start();
          }}
          title="クリックして編集"
          className="min-h-[96px] cursor-text rounded-lg px-2 py-2 hover:bg-neutral-50"
        >
          <RichTextView doc={doc} legacy={legacy} mentionUsers={mentionUsers} />
        </div>
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
