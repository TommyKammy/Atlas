"use client";

import { useState } from "react";
import type { ProjectKnowledge } from "@/lib/data";
import { renderMarkdown } from "@/lib/markdown";
import { useApiRefresh } from "./ListView";
import EmptyState from "./EmptyState";

type Composer = { id: number | null; title: string; body: string };

export default function KnowledgeView({
  projectId,
  initial,
}: {
  projectId: number;
  initial: ProjectKnowledge[];
}) {
  const refresh = useApiRefresh();
  const [composer, setComposer] = useState<Composer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!composer || busy) return;
    if (!composer.title.trim() || !composer.body.trim()) {
      setError("タイトルと本文を入力してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        composer.id === null ? "/api/knowledge" : `/api/knowledge/${composer.id}`,
        {
          method: composer.id === null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(composer.id === null ? { project_id: projectId } : {}),
            title: composer.title.trim(),
            body: composer.body.trim(),
          }),
        },
      );
      if (!res.ok) throw new Error(`保存に失敗しました (${res.status})`);
      setComposer(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (note: ProjectKnowledge) => {
    if (!window.confirm(`「${note.title}」を削除しますか？`)) return;
    const res = await fetch(`/api/knowledge/${note.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`削除に失敗しました (${res.status})`);
      return;
    }
    refresh();
  };

  return (
    <div data-knowledge className="max-w-4xl px-4 pb-16">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-neutral-900">プロジェクトの知識</h2>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            方針、議事録、リンク、ノートをプロジェクトにまとめて共有できます。
          </p>
        </div>
        <button
          type="button"
          data-knowledge-new
          onClick={() => {
            setError("");
            setComposer({ id: null, title: "", body: "" });
          }}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-[#e1e1e1] bg-white px-3 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50"
        >
          <span className="text-[15px] leading-none">＋</span> ノートを追加
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </p>
      )}

      {composer && (
        <form
          onSubmit={save}
          data-knowledge-composer
          className="mt-4 rounded-lg border border-[#e1e1e1] bg-white p-4 shadow-sm"
        >
          <input
            value={composer.title}
            onChange={(event) => setComposer({ ...composer, title: event.target.value })}
            placeholder="タイトル"
            data-knowledge-title
            autoFocus
            className="w-full border-b border-neutral-200 px-1 py-1.5 text-[15px] font-semibold outline-none focus:border-[#2c60b8]"
          />
          <textarea
            value={composer.body}
            onChange={(event) => setComposer({ ...composer, body: event.target.value })}
            placeholder="本文（Markdown）"
            data-knowledge-body
            rows={6}
            className="mt-2 w-full resize-y rounded-md border border-neutral-200 px-2 py-1.5 text-[13px] leading-5 outline-none focus:border-[#2c60b8]"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setComposer(null)}
              className="rounded px-3 py-1.5 text-[13px] text-neutral-500 hover:bg-neutral-100"
            >
              キャンセル
            </button>
            <button
              type="submit"
              data-knowledge-save
              disabled={busy}
              className="rounded bg-[#2c60b8] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
            >
              {composer.id === null ? "追加" : "保存"}
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 space-y-3">
        {initial.length === 0 ? (
          <EmptyState
            scope="knowledge"
            title="知識を蓄積する"
            description="プロジェクトの背景、決定事項、便利なリンクをノートとして残しましょう。"
          />
        ) : (
          initial.map((note) => (
            <article
              key={note.id}
              data-knowledge-note={note.id}
              className="rounded-lg border border-[#e1e1e1] bg-white p-4"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-neutral-900">{note.title}</h3>
                  <div className="mt-0.5 text-[11px] text-neutral-400">
                    {note.author_name ?? "不明"} ・ 更新 {note.updated_at}
                  </div>
                </div>
                <button
                  type="button"
                  data-knowledge-edit={note.id}
                  aria-label={`${note.title}を編集`}
                  onClick={() => {
                    setError("");
                    setComposer({ id: note.id, title: note.title, body: note.body });
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="m10.5 2.5 3 3L6 13H3v-3z" />
                  </svg>
                </button>
                <button
                  type="button"
                  data-knowledge-delete={note.id}
                  aria-label={`${note.title}を削除`}
                  onClick={() => void remove(note)}
                  className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8h5.8l.6-8M6.5 7v3M9.5 7v3" />
                  </svg>
                </button>
              </div>
              <div
                className="mt-3 text-[13px] leading-6 [&_a]:text-blue-700 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }}
              />
            </article>
          ))
        )}
      </div>
    </div>
  );
}
