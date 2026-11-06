"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type TaskHit = { id: number; name: string; project_id: number; project_name: string };
type ProjectHit = { id: number; name: string };
type MessageHit = { id: number; title: string; project_id: number; project_name: string };
type KnowledgeHit = { id: number; title: string; project_id: number; project_name: string };
type FileHit = {
  id: number;
  file_name: string;
  task_id: number;
  project_id: number;
  project_name: string;
};

type SuggestData = {
  history: string[];
  groups: {
    tasks?: TaskHit[];
    projects?: ProjectHit[];
    messages?: MessageHit[];
    knowledge?: KnowledgeHit[];
    files?: FileHit[];
  };
};

const EMPTY: SuggestData = { history: [], groups: {} };

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SuggestData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal })
          .then((res) => (res.ok ? res.json() : EMPTY))
          .then((json: SuggestData) => setData(json))
          .catch(() => undefined)
          .finally(() => setLoading(false));
      },
      q === "" ? 0 : 200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, open]);

  const submit = () => {
    const query = q.trim();
    if (!query) return;
    fetch("/api/search/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }).catch(() => undefined);
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const clearHistory = async () => {
    await fetch("/api/search/history", { method: "DELETE" }).catch(() => undefined);
    setData((prev) => ({ ...prev, history: [] }));
  };

  const groups = data.groups ?? {};
  const resultCount =
    (groups.tasks?.length ?? 0) +
    (groups.projects?.length ?? 0) +
    (groups.messages?.length ?? 0) +
    (groups.knowledge?.length ?? 0) +
    (groups.files?.length ?? 0);
  const showMenu = open && (q === "" || loading || resultCount > 0 || data.history.length >= 0);
  const sectionLabel = "px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400";
  const rowClass =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-neutral-800 hover:bg-neutral-100";

  return (
    <div
      ref={root}
      data-global-search
      className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 px-4 md:block"
    >
      <div className="pointer-events-auto relative mx-auto w-full max-w-[640px]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 text-neutral-400"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4" />
        </svg>
        <input
          data-global-search-input
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="タスク、プロジェクト、メッセージを検索"
          aria-label="グローバル検索"
          className="w-full rounded-full bg-[#333333] py-1.5 pr-4 pl-9 text-sm text-white placeholder:text-neutral-400 outline-none hover:bg-[#3a3a3a] focus:bg-[#3a3a3a]"
        />
        {showMenu && (
          <div
            data-global-search-menu
            className="absolute top-full right-0 left-0 z-50 mt-2 max-h-[70vh] overflow-auto rounded-lg border border-neutral-200 bg-white py-1 text-neutral-900 shadow-2xl"
          >
            {q === "" ? (
              data.history.length > 0 ? (
                <div data-global-search-history>
                  <div className="flex items-center justify-between px-3 pt-2 pb-1">
                    <span className="text-[11px] font-semibold tracking-wide text-neutral-400">
                      最近の検索
                    </span>
                    <button
                      type="button"
                      data-global-search-clear
                      onClick={() => void clearHistory()}
                      className="text-[11px] text-neutral-500 hover:underline"
                    >
                      履歴をクリア
                    </button>
                  </div>
                  {data.history.map((item) => (
                    <button
                      key={item}
                      type="button"
                      data-global-search-history-item={item}
                      onClick={() => {
                        setOpen(false);
                        router.push(`/search?q=${encodeURIComponent(item)}`);
                      }}
                      className={rowClass}
                    >
                      <span className="text-neutral-400">↺</span>
                      <span className="truncate">{item}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2 text-[12px] text-neutral-500">
                  検索履歴はありません。キーワードを入力してください。
                </div>
              )
            ) : (
              <>
                {groups.tasks && groups.tasks.length > 0 && (
                  <div>
                    <div className={sectionLabel}>タスク</div>
                    {groups.tasks.map((task) => (
                      <Link
                        key={`task-${task.id}`}
                        href={`/projects/${task.project_id}?view=list&task=${task.id}`}
                        data-global-search-option={`task-${task.id}`}
                        onClick={() => setOpen(false)}
                        className={rowClass}
                      >
                        <span className="min-w-0 flex-1 truncate">{task.name}</span>
                        <span className="shrink-0 text-[11px] text-neutral-400">{task.project_name}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {groups.projects && groups.projects.length > 0 && (
                  <div>
                    <div className={sectionLabel}>プロジェクト</div>
                    {groups.projects.map((project) => (
                      <Link
                        key={`project-${project.id}`}
                        href={`/projects/${project.id}?view=list`}
                        data-global-search-option={`project-${project.id}`}
                        onClick={() => setOpen(false)}
                        className={rowClass}
                      >
                        <span className="truncate">{project.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {groups.messages && groups.messages.length > 0 && (
                  <div>
                    <div className={sectionLabel}>メッセージ</div>
                    {groups.messages.map((message) => (
                      <Link
                        key={`message-${message.id}`}
                        href={`/projects/${message.project_id}?view=messages`}
                        data-global-search-option={`message-${message.id}`}
                        onClick={() => setOpen(false)}
                        className={rowClass}
                      >
                        <span className="min-w-0 flex-1 truncate">{message.title || "(件名なし)"}</span>
                        <span className="shrink-0 text-[11px] text-neutral-400">{message.project_name}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {groups.knowledge && groups.knowledge.length > 0 && (
                  <div>
                    <div className={sectionLabel}>知識</div>
                    {groups.knowledge.map((note) => (
                      <Link
                        key={`knowledge-${note.id}`}
                        href={`/projects/${note.project_id}?view=knowledge`}
                        data-global-search-option={`knowledge-${note.id}`}
                        onClick={() => setOpen(false)}
                        className={rowClass}
                      >
                        <span className="min-w-0 flex-1 truncate">{note.title}</span>
                        <span className="shrink-0 text-[11px] text-neutral-400">{note.project_name}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {groups.files && groups.files.length > 0 && (
                  <div>
                    <div className={sectionLabel}>ファイル</div>
                    {groups.files.map((file) => (
                      <Link
                        key={`file-${file.id}`}
                        href={`/projects/${file.project_id}?view=list&task=${file.task_id}`}
                        data-global-search-option={`file-${file.id}`}
                        onClick={() => setOpen(false)}
                        className={rowClass}
                      >
                        <span className="min-w-0 flex-1 truncate">{file.file_name}</span>
                        <span className="shrink-0 text-[11px] text-neutral-400">{file.project_name}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {!loading && resultCount === 0 && (
                  <div data-global-search-empty className="px-3 py-4 text-center text-[13px] text-neutral-500">
                    「{q}」に一致する結果はありません
                  </div>
                )}
                {loading && <div className="px-3 py-2 text-[12px] text-neutral-400">検索中…</div>}
                <Link
                  href={`/search?q=${encodeURIComponent(q)}`}
                  data-global-search-all
                  onClick={() => {
                    fetch("/api/search/history", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ query: q }),
                    }).catch(() => undefined);
                    setOpen(false);
                  }}
                  className="mt-1 flex items-center justify-between border-t border-neutral-100 px-3 py-2 text-[12px] font-medium text-[#2c60b8] hover:bg-neutral-50"
                >
                  すべての検索結果を表示
                  <span aria-hidden="true">→</span>
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
