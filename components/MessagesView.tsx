"use client";

import { ProjectViewToolbar, ViewAddButton } from "@/components/view/ProjectViewToolbar";
import { useEffect, useState } from "react";
import type { ProjectMessage } from "@/lib/data";
import { renderMarkdown } from "@/lib/markdown";
import { useApiRefresh } from "@/lib/use-api-refresh";
import EmptyState from "./EmptyState";

export default function MessagesView({
  projectId,
  initial,
}: {
  projectId: number;
  initial: ProjectMessage[];
}) {
  const refresh = useApiRefresh();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (new URLSearchParams(window.location.search).get("focus") === "composer") setOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const post = async () => {
    if (!body.trim()) return;
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, title, body }),
    });
    if (!res.ok) throw new Error(`POST /api/messages: ${res.status}`);
    setTitle("");
    setBody("");
    setOpen(false);
    refresh();
  };

  return (
    <div className="max-w-3xl px-4 pb-16">
      <ProjectViewToolbar>
        <ViewAddButton data-message-new onClick={() => setOpen(true)} disabled={open}>メッセージを作成</ViewAddButton>
      </ProjectViewToolbar>
      {open && (
        <div className="mt-4 rounded-lg border p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="件名（任意）"
            autoFocus
            className="w-full border-b px-1 py-1 text-sm font-semibold outline-none focus:border-blue-500"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="メッセージを投稿（プロジェクト全体への連絡）"
            rows={4}
            className="mt-2 w-full text-sm outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">プロジェクト全体に送信されます</span>
            <span className="flex-1" />
            <button
              onClick={() => setOpen(false)}
              className="rounded px-3 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
            >
              キャンセル
            </button>
            <button
              onClick={post}
              className="rounded bg-blue-600 px-4 py-1 text-sm text-white hover:bg-blue-700"
            >
              投稿
            </button>
          </div>
        </div>
      )}
      <div className="mt-4">
        {initial.length === 0 ? (
          <EmptyState
            scope="messages"
            title="会話を仕事につなげる"
            description="メッセージを送信して、プロジェクトを開始する、タスクについて話し合う、またはアイデアを共有しましょう。"
          />
        ) : (
          initial.map((m) => (
            <div key={m.id} className="border-b py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-300 text-[10px] font-bold text-white">
                  {(m.author_name ?? "?").slice(0, 1)}
                </span>
                <span className="text-xs font-semibold text-neutral-600">{m.author_name ?? "–"}</span>
                <span className="text-xs text-neutral-500">{m.created_at}</span>
              </div>
              {m.title && <div className="mt-1.5 font-semibold">{m.title}</div>}
              <div
                className="mt-1 text-sm [&_a]:text-blue-700 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.body) }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
