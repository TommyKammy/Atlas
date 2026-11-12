"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectKnowledge } from "@/lib/data";
import { renderMarkdown } from "@/lib/markdown";
import { knowledgeExtensions } from "@/lib/knowledge-extensions";
import { confirmAction } from "@/lib/ui-feedback";
import KnowledgeComposer, { downloadNote } from "./knowledge/KnowledgeComposer";
import RichTextEditor from "./rich-text/RichTextEditor";

const templates = [
  { name: "白紙", body: "" },
  { name: "議事録", body: "## 議題\n\n## 決定事項\n\n## 次のアクション\n- [ ] 担当者と期限を決める" },
  { name: "手順書", body: "## 目的\n\n## 事前準備\n- [ ] 必要なものを確認する\n\n## 手順\n1. 最初の手順\n\n## 確認事項" },
];
type History = { revision: number; title: string; saved_at: string };
const date = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const button = "rounded-md border border-neutral-200 px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50";

export default function KnowledgeView({ projectId, initial, canEdit = false, initialNoteId, viewerId }: {
  projectId: number; initial: ProjectKnowledge[]; canEdit?: boolean; initialNoteId?: number; viewerId: number;
}) {
  const [notes, setNotes] = useState(initial);
  const [selectedId, setSelectedId] = useState(initialNoteId || initial[0]?.id || null);
  const [search, setSearch] = useState("");
  const searchRef = useRef("");
  const [results, setResults] = useState<ProjectKnowledge[] | null>(null);
  const [searchMore, setSearchMore] = useState(false);
  const [hasMore, setHasMore] = useState(initial.length >= 100);
  const [offset, setOffset] = useState(Math.min(initial.length, 100));
  const [editing, setEditing] = useState<{ note: ProjectKnowledge | null; key: string; template?: string } | null>(null);
  const [history, setHistory] = useState<History[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  const selected = notes.find(note => note.id === selectedId);
  const filtered = search && results ? results : notes.filter(note => `${note.title}\n${note.body}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const saved = (note: ProjectKnowledge) => {
    setNotes(items => [note, ...items.filter(item => item.id !== note.id)]);
    setSelectedId(note.id);
  };
  const api = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `操作できませんでした (${response.status})`);
    return data;
  };
  const action = async (run: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError("");
    try { await run(); } catch (error) { setError(error instanceof Error ? error.message : "操作できませんでした"); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!search) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/knowledge?project_id=${projectId}&q=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error("検索できませんでした。もう一度検索してください");
          const items = await response.json() as ProjectKnowledge[];
          if (!controller.signal.aborted) { setResults(items); setSearchMore(items.length === 100); }
        }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, projectId]);
  const loadMore = () => void action(async () => {
    const items = await api(`/api/knowledge?project_id=${projectId}&q=${encodeURIComponent(search)}&offset=${search ? results?.length ?? 0 : offset}`) as ProjectKnowledge[];
    if (searchRef.current !== search) return;
    if (search) { setResults(previous => [...(previous ?? []), ...items]); setSearchMore(items.length === 100); }
    else { setNotes(previous => [...previous, ...items.filter(item => !previous.some(note => note.id === item.id))]); setOffset(value => value + items.length); setHasMore(items.length === 100); }
  });
  const leave = async () => !guard.current || await guard.current();
  const select = (id: number) => void action(async () => {
    if (!await leave()) return;
    const note = await api(`/api/knowledge/${id}`) as ProjectKnowledge;
    saved(note); setEditing(null); setHistory(null);
    const url = new URL(window.location.href); url.searchParams.set("note", String(id));
    window.history.replaceState(null, "", url);
  });
  const create = (body = "") => void action(async () => {
    if (!await leave()) return;
    setHistory(null); setEditing({ note: null, key: crypto.randomUUID(), template: body });
  });
  const edit = () => void action(async () => {
    if (!selected) return;
    const note = await api(`/api/knowledge/${selected.id}`) as ProjectKnowledge;
    saved(note); setHistory(null); setEditing({ note, key: crypto.randomUUID() });
  });
  const close = () => { setEditing(null); guard.current = null; };
  const links = notes.map(note => ({ title: note.title, href: `/projects/${projectId}?view=knowledge&note=${note.id}` }));

  return <div data-knowledge className="px-4 pb-12 text-neutral-900">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">プロジェクトの知識</h2><p className="mt-1 text-sm text-neutral-600">決定事項、議事録、手順をチームに残す</p></div>
      {canEdit && <button data-knowledge-new disabled={busy} onClick={() => create()} className="rounded-md bg-[#2c60b8] px-3 py-2 text-sm font-medium text-white hover:bg-[#24529c] disabled:opacity-50">＋ ノートを追加</button>}
    </div>
    {error && <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid min-w-0 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside aria-label="ノート一覧" className={`${editing ? "hidden lg:block" : ""} min-w-0 border-b border-neutral-200 pb-4 lg:border-r lg:border-b-0 lg:pr-5`}>
        <label className="sr-only" htmlFor="knowledge-search">ノートを検索</label>
        <input id="knowledge-search" type="search" value={search} maxLength={300} onChange={event => { searchRef.current = event.target.value; setSearch(event.target.value); setResults(null); setSearchMore(false); setError(""); }} placeholder="タイトル・本文を検索" className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm placeholder:text-neutral-600 focus:outline-blue-600" />
        <p className="mb-2 text-xs text-neutral-600">{search && results === null ? "検索中…" : `${filtered.length} 件${(search ? searchMore : hasMore) ? "以上" : ""}のノート`}</p>
        <nav className="flex max-h-64 gap-1 overflow-auto lg:max-h-[65vh] lg:flex-col" aria-label="ノートを選択">
          {filtered.map(note => <button key={note.id} data-knowledge-note={note.id} aria-current={selectedId === note.id ? "page" : undefined}
            disabled={busy} onClick={() => select(note.id)} className={`min-w-40 shrink-0 rounded-md px-3 py-2.5 text-left lg:min-w-0 ${selectedId === note.id ? "bg-blue-50 text-blue-800" : "hover:bg-neutral-50"}`}>
            <span className="block max-w-52 truncate text-sm font-medium">{note.title}</span>
            <span className="mt-1 block text-xs text-neutral-600">{date(note.updated_at)}</span>
          </button>)}
        </nav>
        {(search ? searchMore : hasMore) && <button disabled={busy} className={`${button} mt-3 w-full`} onClick={loadMore}>さらに読み込む</button>}
        {filtered.length === 0 && <p className="py-4 text-sm text-neutral-600">{search ? "一致するノートがありません" : "ノートはまだありません"}</p>}
        {canEdit && <div className="mt-5 border-t border-neutral-200 pt-4">
          <p className="mb-2 text-xs font-medium text-neutral-600">テンプレートから作成</p>
          <div className="flex flex-wrap gap-2 lg:flex-col">
            {templates.map(template => <button key={template.name} disabled={busy} onClick={() => create(template.body)} className="rounded px-2 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100">＋ {template.name}</button>)}
          </div>
        </div>}
      </aside>
      <section aria-label="ノート" className="min-w-0 max-w-4xl">
        {editing ? <KnowledgeComposer key={editing.key} note={editing.note} template={editing.template} projectId={projectId} viewerId={viewerId} links={links} guardRef={guard} onSaved={saved} onClose={close} /> : selected ? <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
            <span className="text-xs text-neutral-600">{selected.author_name ?? "メンバー"} · {date(selected.updated_at)} 更新</span>
            <div className="flex flex-wrap gap-2">
              <button className={button} onClick={() => downloadNote(selected.title, selected.body)}>書き出す</button>
              <button className={button} disabled={busy} onClick={() => void action(async () => setHistory(history ? null : await api(`/api/knowledge/${selected.id}?history=1`)))}>履歴</button>
              {canEdit && <><button data-knowledge-edit className={button} disabled={busy} onClick={edit}>ノートを編集</button>
                <button className={button} disabled={busy} onClick={() => void action(async () => {
                  if (!await confirmAction(`「${selected.title}」と保存履歴を削除しますか？`)) return;
                  await api(`/api/knowledge/${selected.id}?revision=${selected.revision}`, { method: "DELETE" });
                  setNotes(items => items.filter(note => note.id !== selected.id)); setSelectedId(null); setHistory(null);
                })}>削除</button></>}
            </div>
          </div>
          {history && <div className="mb-6 rounded-md border border-neutral-200 p-4" data-knowledge-history>
            <h3 className="text-sm font-semibold">保存履歴</h3>
            <p className="mt-1 text-xs text-neutral-600">直近50件と初版。復元前の内容も履歴に残ります。</p>
            {history.length === 0 && <p className="mt-3 text-sm text-neutral-600">以前の保存内容はありません。</p>}
            <ul className="mt-3 max-h-60 overflow-auto divide-y divide-neutral-100">
              {history.map(item => <li key={item.revision} className="flex items-center justify-between gap-2 py-2 text-xs"><span className="min-w-0 break-words">{date(item.saved_at)} · {item.title} {item.revision === 0 ? "（初版）" : ""}</span>
                {canEdit && <button className={button} disabled={busy} onClick={() => void action(async () => {
                  if (!await confirmAction("この履歴の内容に復元しますか？現在の内容は履歴に残ります。")) return;
                  const restored = await api(`/api/knowledge/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: selected.revision, restore_revision: item.revision }) });
                  saved(restored); setHistory(null);
                })}>復元</button>}</li>)}
            </ul>
          </div>}
          <h1 className="mb-6 break-words text-3xl leading-snug font-semibold tracking-tight">{selected.title}</h1>
          {selected.body_doc ? <RichTextEditor key={`${selected.id}:${selected.revision}`} initialDoc={selected.body_doc} extraExtensions={knowledgeExtensions} editable={false} toolbar={false} borderless ariaLabel="ノートの内容" className="knowledge-document" />
            : <div data-knowledge-legacy className="atlas-rich-text knowledge-document" dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.body) }} />}
        </> : <div className="py-16 text-center">
          <h3 className="text-lg font-semibold">チームの知識をここに</h3><p className="mt-2 text-sm text-neutral-600">ノートを選択して読むか、議事録や手順書を作成できます。</p>
          {canEdit && <button onClick={() => create()} className="mt-5 rounded-md bg-[#2c60b8] px-4 py-2 text-sm text-white">最初のノートを作成</button>}
        </div>}
      </section>
    </div>
  </div>;
}
