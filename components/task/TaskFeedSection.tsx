"use client";

import { useMemo, useState } from "react";
import type { CommentRow } from "@/lib/data";
import { docToText, markdownToDoc } from "@/lib/rich-text-markdown";
import type { MentionUser, RichTextDoc } from "@/lib/rich-text-types";
import { toast } from "@/lib/ui-feedback";
import RichTextEditor from "../rich-text/RichTextEditor";
import RichTextView from "../rich-text/RichTextView";

type FeedEvent = { id: number; summary: string; actor_name: string | null; created_at: string };
type Reaction = { emoji: string; n: number; mine: boolean };

type FeedItem =
  | { kind: "comment"; id: number; at: string; comment: CommentRow }
  | { kind: "event"; id: number; at: string; event: FeedEvent };

function formatWhen(value: string): string {
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace("T", " ");
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function Avatar({ name, className = "h-7 w-7" }: { name: string | null; className?: string }) {
  const label = (name ?? "?").trim() || "?";
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-[#d8e3f3] text-[10px] font-semibold text-[#38506e]`}
      title={label}
    >
      {label.slice(0, 1)}
    </span>
  );
}

function CommentEditForm({
  comment,
  mentionUsers,
  onCancel,
  onSave,
}: {
  comment: CommentRow;
  mentionUsers: MentionUser[];
  onCancel: () => void;
  onSave: (doc: RichTextDoc) => void | Promise<void>;
}) {
  const initial = comment.body_doc ?? markdownToDoc(comment.body, mentionUsers);
  const [doc, setDoc] = useState<RichTextDoc>(initial);
  const [text, setText] = useState(() => docToText(initial));

  const save = async () => {
    if (!text.trim()) return;
    try {
      await onSave(doc);
    } catch (error) {
      toast(`コメントの保存に失敗しました: ${error instanceof Error ? error.message : error}`);
    }
  };

  return (
    <div className="mt-1">
      <RichTextEditor
        initialDoc={initial}
        mentionUsers={mentionUsers}
        placeholder="コメントを編集"
        ariaLabel="コメントを編集"
        dataAttributes={{ "data-comment-edit-input": String(comment.id) }}
        autoFocus
        compact
        minHeightClass="min-h-[64px]"
        onChange={(nextDoc, nextText) => {
          setDoc(nextDoc);
          setText(nextText);
        }}
        onSubmit={() => void save()}
      />
      <div className="mt-1 flex justify-end gap-1.5">
        <button
          type="button"
          data-comment-edit-cancel={comment.id}
          onClick={onCancel}
          className="rounded px-2 py-1 text-[11px] text-muted hover:bg-hover"
        >
          キャンセル
        </button>
        <button
          type="button"
          data-comment-edit-save={comment.id}
          disabled={!text.trim()}
          onClick={() => void save()}
          className="rounded bg-accent px-3 py-1 text-[11px] font-medium text-on-accent hover:bg-accent-hover disabled:bg-neutral-200 disabled:text-neutral-500"
        >
          保存
        </button>
      </div>
    </div>
  );
}

/** Asana-style comments and activity feed in the task pane. */
export default function TaskFeedSection({
  feedTab,
  onFeedTab,
  comments,
  events,
  viewerId,
  viewerCanModerate,
  onSaveEdit,
  onDelete,
  reactionMap,
  quickEmojis,
  onToggleReaction,
  mentionUsers,
}: {
  feedTab: "comments" | "activity";
  onFeedTab: (tab: "comments" | "activity") => void;
  comments: CommentRow[];
  events: FeedEvent[];
  viewerId: number;
  viewerCanModerate: boolean;
  onSaveEdit: (commentId: number, doc: RichTextDoc) => void | Promise<void>;
  onDelete: (commentId: number) => void;
  reactionMap: Record<number, Reaction[]>;
  quickEmojis: string[];
  onToggleReaction: (commentId: number, emoji: string) => void;
  mentionUsers: MentionUser[];
}) {
  const [oldestFirst, setOldestFirst] = useState(true);
  const [expandedUpdates, setExpandedUpdates] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);

  const items = useMemo<FeedItem[]>(() => {
    const commentItems: FeedItem[] = comments.map((comment) => ({
      kind: "comment",
      id: comment.id,
      at: comment.created_at,
      comment,
    }));
    const eventItems: FeedItem[] = events.map((event) => ({
      kind: "event",
      id: event.id,
      at: event.created_at,
      event,
    }));
    const merged = feedTab === "comments" ? commentItems : [...commentItems, ...eventItems];
    return merged.sort((a, b) => (oldestFirst ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)));
  }, [comments, events, feedTab, oldestFirst]);

  const renderComment = (comment: CommentRow) => {
    const canEdit = comment.author_id === viewerId || viewerCanModerate;
    return (
      <div
        key={`comment-${comment.id}`}
        data-comment-id={comment.id}
        data-comment-author-id={comment.author_id ?? ""}
        className="group/comment flex gap-2.5 py-2.5"
      >
        <Avatar name={comment.author_name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-semibold text-text">{comment.author_name ?? "–"}</span>
            <span className="text-subtle">{formatWhen(comment.created_at)}</span>
            {comment.edited_at && (
              <span data-comment-edited={comment.id} className="text-[10px] text-subtle">
                編集済み
              </span>
            )}
            {canEdit && editingCommentId !== comment.id && (
              <span className="ml-auto flex items-center gap-2 opacity-0 transition-opacity group-hover/comment:opacity-100">
                <button
                  type="button"
                  data-comment-edit={comment.id}
                  onClick={() => setEditingCommentId(comment.id)}
                  className="text-[10px] text-muted hover:text-text hover:underline"
                >
                  編集
                </button>
                <button
                  type="button"
                  data-comment-delete={comment.id}
                  onClick={() => onDelete(comment.id)}
                  className="text-[10px] text-red-500 hover:text-red-700 hover:underline"
                >
                  削除
                </button>
              </span>
            )}
          </div>

          {editingCommentId === comment.id ? (
            <CommentEditForm
              comment={comment}
              mentionUsers={mentionUsers}
              onCancel={() => setEditingCommentId(null)}
              onSave={async (doc) => {
                await onSaveEdit(comment.id, doc);
                setEditingCommentId(null);
              }}
            />
          ) : (
            <div data-comment-body={comment.id} className="mt-0.5">
              <RichTextView
                doc={comment.body_doc}
                legacy={comment.body}
                mentionUsers={mentionUsers}
                className="text-[13px] leading-5 text-secondary"
              />
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {(reactionMap[comment.id] ?? []).map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                data-comment-reaction={reaction.emoji}
                aria-pressed={reaction.mine}
                onClick={() => onToggleReaction(comment.id, reaction.emoji)}
                title="リアクション切替"
                className={`rounded-full border px-1.5 py-0.5 text-[11px] ${
                  reaction.mine
                    ? "border-blue-400 bg-accent-soft text-accent-text"
                    : "border-line bg-surface text-secondary hover:bg-hover"
                }`}
              >
                {reaction.emoji} {reaction.n}
              </button>
            ))}
            {quickEmojis
              .filter((emoji) => !(reactionMap[comment.id] ?? []).some((reaction) => reaction.emoji === emoji))
              .slice(0, 3)
              .map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  data-comment-reaction-add={emoji}
                  onClick={() => onToggleReaction(comment.id, emoji)}
                  title="リアクションする"
                  className="rounded-full border border-dashed border-line px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-hover hover:text-neutral-600"
                >
                  {emoji} ＋
                </button>
              ))}
          </div>
        </div>
      </div>
    );
  };

  const renderEvent = (event: FeedEvent) => (
    <div key={`event-${event.id}`} data-task-event-id={event.id} className="flex gap-2.5 py-1.5">
      <Avatar name={event.actor_name} className="h-6 w-6" />
      <div className="min-w-0 flex-1 text-[12px] leading-5">
        <span className="font-medium text-secondary">{event.actor_name ?? "システム"}</span>{" "}
        <span className="text-muted">{event.summary}</span>
        <span className="ml-1.5 text-[10px] text-subtle">{formatWhen(event.created_at)}</span>
      </div>
    </div>
  );

  const renderItem = (item: FeedItem) =>
    item.kind === "comment" ? renderComment(item.comment) : renderEvent(item.event);

  const collapsed = feedTab === "activity" && !expandedUpdates && items.length > 8;
  const headItems = collapsed ? items.slice(0, 2) : items;
  const hiddenItems = collapsed ? items.slice(2, -4) : [];
  const tailItems = collapsed ? items.slice(-4) : [];

  return (
    <section className="mt-5" data-task-feed>
      <div className="flex min-h-8 items-center gap-1 border-b border-line pb-1">
        <button
          type="button"
          onClick={() => onFeedTab("comments")}
          className={`rounded-full px-2.5 py-1 text-[12px] ${
            feedTab === "comments"
              ? "bg-accent-soft font-semibold text-accent-text"
              : "text-muted hover:bg-hover hover:text-secondary"
          }`}
        >
          コメント{comments.length > 0 ? ` ${comments.length}` : ""}
        </button>
        <button
          type="button"
          onClick={() => onFeedTab("activity")}
          className={`rounded-full px-2.5 py-1 text-[12px] ${
            feedTab === "activity"
              ? "bg-accent-soft font-semibold text-accent-text"
              : "text-muted hover:bg-hover hover:text-secondary"
          }`}
        >
          すべてのアクティビティ
        </button>
        <button
          type="button"
          onClick={() => setOldestFirst((value) => !value)}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted hover:bg-hover hover:text-secondary"
          title="並べ替え"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 4.8V8l2.2 1.4" />
          </svg>
          {oldestFirst ? "古い順" : "新しい順"}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="py-4 text-center text-[12px] text-subtle">
          {feedTab === "comments" ? "まだコメントはありません" : "アクティビティはまだありません"}
        </div>
      ) : feedTab === "comments" ? (
        <div>{items.map((item) => (item.kind === "comment" ? renderComment(item.comment) : null))}</div>
      ) : (
        <div className="pt-1">
          {headItems.map(renderItem)}
          {collapsed && (
            <>
              <button
                type="button"
                onClick={() => setExpandedUpdates(true)}
                className="my-1 rounded px-1 py-0.5 text-[11px] font-medium text-accent-text hover:bg-accent-soft hover:underline"
              >
                過去の更新を表示（{hiddenItems.length} 件）
              </button>
              <div hidden>{hiddenItems.map(renderItem)}</div>
            </>
          )}
          {tailItems.map(renderItem)}
        </div>
      )}
    </section>
  );
}
