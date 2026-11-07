"use client";

import type { CommentRow } from "@/lib/data";

type FeedEvent = { id: number; summary: string; actor_name: string | null; created_at: string };
type Reaction = { emoji: string; n: number; mine: boolean };

/** Comments and activity feed in the task pane. */
export default function TaskFeedSection({
  feedTab,
  onFeedTab,
  comments,
  events,
  viewerId,
  viewerCanModerate,
  editingCommentId,
  commentEditDraft,
  onCommentEditDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  reactionMap,
  quickEmojis,
  onToggleReaction,
  renderCommentBody,
}: {
  feedTab: "comments" | "activity";
  onFeedTab: (tab: "comments" | "activity") => void;
  comments: CommentRow[];
  events: FeedEvent[];
  viewerId: number;
  viewerCanModerate: boolean;
  editingCommentId: number | null;
  commentEditDraft: string;
  onCommentEditDraft: (value: string) => void;
  onStartEdit: (comment: CommentRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (commentId: number) => void;
  onDelete: (commentId: number) => void;
  reactionMap: Record<number, Reaction[]>;
  quickEmojis: string[];
  onToggleReaction: (commentId: number, emoji: string) => void;
  renderCommentBody: (body: string) => string;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 border-b pb-1 text-sm">
        <button
          onClick={() => onFeedTab("comments")}
          className={`rounded px-2 py-1 ${feedTab === "comments" ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}
        >
          コメント
        </button>
        <button
          onClick={() => onFeedTab("activity")}
          className={`rounded px-2 py-1 ${feedTab === "activity" ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}
        >
          すべてのアクティビティ
        </button>
      </div>
      {feedTab === "comments" ? (
        comments.length === 0 ? (
          <div className="py-3 text-sm text-neutral-500">まだコメントはありません</div>
        ) : (
          comments.map((c) => {
            const canEdit = c.author_id === viewerId || viewerCanModerate;
            return (
              <div
                key={c.id}
                data-comment-id={c.id}
                data-comment-author-id={c.author_id ?? ""}
                className="flex gap-2 py-2 text-sm"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-300 text-xs font-bold text-neutral-800">
                  {(c.author_name ?? "?").slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1 rounded-lg bg-neutral-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
                    <span>{c.author_name ?? "–"}</span>
                    {c.edited_at && (
                      <span data-comment-edited={c.id} className="font-normal text-neutral-400">
                        編集済み
                      </span>
                    )}
                    {canEdit && editingCommentId !== c.id && (
                      <span className="ml-auto flex items-center gap-2 font-normal">
                        <button
                          type="button"
                          data-comment-edit={c.id}
                          onClick={() => onStartEdit(c)}
                          className="text-[11px] text-neutral-500 hover:underline"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          data-comment-delete={c.id}
                          onClick={() => onDelete(c.id)}
                          className="text-[11px] text-red-600 hover:underline"
                        >
                          削除
                        </button>
                      </span>
                    )}
                  </div>
                  {editingCommentId === c.id ? (
                    <div className="mt-1">
                      <textarea
                        data-comment-edit-input={c.id}
                        value={commentEditDraft}
                        onChange={(e) => onCommentEditDraft(e.target.value)}
                        rows={3}
                        className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500"
                      />
                      <div className="mt-1 flex justify-end gap-2">
                        <button
                          type="button"
                          data-comment-edit-cancel={c.id}
                          onClick={onCancelEdit}
                          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          data-comment-edit-save={c.id}
                          onClick={() => onSaveEdit(c.id)}
                          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      data-comment-body={c.id}
                      className="mt-0.5 text-sm [&_a]:text-blue-700 [&_code]:rounded [&_code]:bg-neutral-200 [&_code]:px-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                      dangerouslySetInnerHTML={{ __html: renderCommentBody(c.body) }}
                    />
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {(reactionMap[c.id] ?? []).map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        data-comment-reaction={r.emoji}
                        aria-pressed={r.mine}
                        onClick={() => onToggleReaction(c.id, r.emoji)}
                        title="リアクション切替"
                        className={`rounded-full border px-1.5 py-0.5 text-xs ${
                          r.mine ? "border-blue-500 bg-blue-50" : "hover:bg-neutral-100"
                        }`}
                      >
                        {r.emoji} {r.n}
                      </button>
                    ))}
                    {quickEmojis
                      .filter((e) => !(reactionMap[c.id] ?? []).some((r) => r.emoji === e))
                      .slice(0, 3)
                      .map((e) => (
                        <button
                          key={e}
                          type="button"
                          data-comment-reaction-add={e}
                          onClick={() => onToggleReaction(c.id, e)}
                          title="リアクションする"
                          className="rounded-full border border-dashed px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
                        >
                          {e} ＋
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            );
          })
        )
      ) : (
        <div>
          {events.length === 0 && (
            <div className="py-3 text-sm text-neutral-500">アクティビティはまだありません</div>
          )}
          {events.map((ev) => (
            <div key={ev.id} className="flex gap-2 py-1.5 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-bold text-neutral-600">
                {(ev.actor_name ?? "?").slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-neutral-700">{ev.actor_name ?? "システム"}</span>{" "}
                <span className="text-neutral-600">{ev.summary}</span>
                <div className="text-xs text-neutral-500">{ev.created_at.slice(0, 16).replace("T", " ")}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
