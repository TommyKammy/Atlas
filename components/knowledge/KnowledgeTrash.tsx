"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectKnowledge } from "@/lib/data";
import type { TrashedKnowledge } from "@/lib/services/authorized-data";
import { secondaryButtonClass } from "../ui/form-controls";

export default function KnowledgeTrash({ projectId, onRestored, onBusyChange }: {
  projectId: number; onRestored: (note: ProjectKnowledge) => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const [notes, setNotes] = useState<TrashedKnowledge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const fetchPage = useCallback(async (offset: number, signal?: AbortSignal) => {
    const response = await fetch(`/api/knowledge/trash?project_id=${projectId}&offset=${offset}`, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "ゴミ箱を読み込めませんでした");
    return data as TrashedKnowledge[];
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    fetchPage(0, controller.signal).then(items => {
      if (!controller.signal.aborted) { setNotes(items); setMore(items.length === 100); setLoaded(true); }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [fetchPage, retry]);
  const restore = async (note: TrashedKnowledge) => {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError("");
    try {
      const response = await fetch(`/api/knowledge/${note.id}/restore`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: note.revision }),
      });
      const restored = await response.json();
      if (!response.ok) throw new Error(restored.error ?? "復元できませんでした");
      // Remove only after the server confirms restoration, even if refreshing fails.
      setNotes(items => items.filter(item => item.id !== note.id));
      await onRestored(restored);
    } catch (error) { setError(error instanceof Error ? error.message : "復元できませんでした"); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <section aria-label="ノートのゴミ箱" aria-busy={busy} className="max-w-4xl" data-knowledge-trash>
    <h3 className="text-[16px] font-semibold text-text">ノートのゴミ箱</h3>
    <p className="mt-2 text-[13px] text-muted">本文と保存履歴を保持しています。復元したノートは一覧の末尾に戻ります。</p>
    {error && <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-danger-soft p-3 text-[13px] text-danger">{error}
      <button className={secondaryButtonClass} disabled={busy} onClick={() => { setError(""); setRetry(value => value + 1); }}>再読み込み</button>
    </div>}
    {!loaded && !error && <p role="status" className="py-8 text-[13px] text-muted">ゴミ箱を読み込み中…</p>}
    {loaded && notes.length === 0 && <p className="py-12 text-[13px] text-muted">ゴミ箱は空です。削除したノートはここから復元できます。</p>}
    <ul className="mt-5 divide-y divide-line-subtle">
      {notes.map(note => <li key={note.id} className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-medium text-text">{note.title}</p>
          <p className="mt-1 text-[12px] text-muted">{new Date(note.deleted_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} · {note.deleted_by_name ?? "メンバー"} が削除</p>
        </div>
        <button className={`${secondaryButtonClass} shrink-0`} disabled={busy} aria-label={`「${note.title}」を復元`} onClick={() => void restore(note)}>復元</button>
      </li>)}
    </ul>
    {more && <button className={`${secondaryButtonClass} mt-4`} disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { const items = await fetchPage(notes.length); setNotes(previous => [...previous, ...items]); setMore(items.length === 100); }
      catch (error) { setError(error instanceof Error ? error.message : "読み込めませんでした"); }
      finally { setBusy(false); }
    }}>さらに読み込む</button>}
  </section>;
}
