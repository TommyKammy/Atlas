"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDateTime, plainTextSnippet } from "@/lib/dates";
import type { HomeMention } from "@/lib/home-widgets";
import UserAvatar from "../../UserAvatar";

/** Comments that mention the viewer, with an inbox affordance. */
export default function MentionsWidget({ mentions }: { mentions: HomeMention[] }) {
  const [read, setRead] = useState<number[]>([]);
  const isUnread = (mention: HomeMention) =>
    !mention.is_read && !read.includes(mention.comment_id);
  const unreadCount = mentions.filter(isUnread).length;

  const markRead = (commentId: number) => {
    setRead((current) => (current.includes(commentId) ? current : [...current, commentId]));
    void fetch("/api/inbox/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId }),
    });
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-1.5">
        <span className="text-[11px] text-neutral-400">
          {unreadCount > 0 ? `未読 ${unreadCount}件` : "すべて既読"}
        </span>
        <span className="flex-1" />
        <Link href="/inbox" className="text-[12px] text-[#2c60b8] hover:underline">
          受信トレイ
        </Link>
      </div>

      <div className="min-h-[170px] flex-1">
        {mentions.length === 0 ? (
          <div className="flex h-full min-h-[170px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 text-[15px] text-neutral-400">
              @
            </span>
            <p className="text-[12px] text-neutral-400">自分宛てのメンションはありません。</p>
          </div>
        ) : (
          mentions.slice(0, 6).map((mention) => (
            <Link
              key={mention.comment_id}
              href={`/projects/${mention.project_id}?view=list&task=${mention.task_id}`}
              data-home-mention-row={mention.comment_id}
              onClick={() => markRead(mention.comment_id)}
              className="flex min-w-0 items-start gap-2 border-b border-neutral-100 px-4 py-2.5 last:border-b-0 hover:bg-neutral-50"
            >
              <span className="relative mt-0.5 shrink-0">
                <UserAvatar
                  name={mention.author_name}
                  url={mention.author_avatar_url}
                  className="h-6 w-6"
                  textClassName="text-[9px]"
                />
                {isUnread(mention) && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-[#2c60b8]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-neutral-800">
                    {mention.author_name ?? "不明なユーザー"}
                  </span>
                  <span className="shrink-0 text-[10px] text-neutral-400">
                    {formatDateTime(mention.created_at)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-neutral-600">
                  {plainTextSnippet(mention.body, 90)}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-neutral-400">
                  {mention.project_name} ・ {mention.task_name}
                </span>
              </span>
            </Link>
          ))
        )}
      </div>

      <div className="border-t border-neutral-100 px-4 py-1.5 text-right">
        <Link href="/inbox" className="text-[12px] text-neutral-500 hover:text-neutral-800">
          メンションをすべて表示
        </Link>
      </div>
    </>
  );
}
