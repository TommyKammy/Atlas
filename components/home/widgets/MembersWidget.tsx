"use client";

import Link from "next/link";
import { useState } from "react";
import type { HomeMember } from "@/lib/home-widgets";
import UserAvatar from "../../UserAvatar";

type Tab = "week" | "month";

export default function MembersWidget({ members }: { members: HomeMember[] }) {
  const [tab, setTab] = useState<Tab>("week");

  return (
    <>
      <div className="flex items-center gap-1 border-b border-line-subtle px-4 py-1.5">
        <button
          type="button"
          onClick={() => setTab("week")}
          data-home-tab="week"
          aria-pressed={tab === "week"}
          className={`rounded-full px-2 py-0.5 text-[12px] ${
            tab === "week"
              ? "bg-accent-soft font-medium text-accent-text"
              : "text-muted hover:bg-hover"
          }`}
        >
          今週
        </button>
        <button
          type="button"
          onClick={() => setTab("month")}
          data-home-tab="month"
          aria-pressed={tab === "month"}
          className={`rounded-full px-2 py-0.5 text-[12px] ${
            tab === "month"
              ? "bg-accent-soft font-medium text-accent-text"
              : "text-muted hover:bg-hover"
          }`}
        >
          今月
        </button>
        <span className="ml-2 text-[11px] text-subtle">よく追加するコラボレーター</span>
      </div>
      <div className="min-h-[170px] flex-1 p-2">
        {members.length === 0 ? (
          <div className="flex h-full min-h-[150px] items-center justify-center text-[12px] text-muted">
            表示するメンバーがいません。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {members.slice(0, 8).map((member) => {
              const count = tab === "week" ? member.week_tasks : member.month_tasks;
              return (
                <Link
                  key={member.id}
                  href={`/search?assignee=${member.id}`}
                  data-home-member-row={member.id}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-hover"
                >
                  <UserAvatar name={member.name} url={member.avatar_url} className="h-7 w-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-text">
                      {member.name}
                    </span>
                    <span className="block truncate text-[11px] text-subtle">
                      {member.title ?? `${member.shared_projects}件の共有プロジェクト`}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{count}件</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <div className="border-t border-line-subtle px-4 py-1.5 text-right">
        <Link href="/portfolio" className="text-[12px] text-muted hover:text-text">
          メンバーをすべて表示
        </Link>
      </div>
    </>
  );
}
