"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Editor } from "@tiptap/core";
import type { ProjectKnowledge } from "@/lib/data";
import type { RichTextDoc } from "@/lib/rich-text-types";
import { markdownToDoc } from "@/lib/rich-text-markdown";
import { knowledgeExtensions } from "@/lib/knowledge-extensions";
import { knowledgeMarkdown, validateKnowledgeDoc } from "@/lib/knowledge-document";
import { confirmAction } from "@/lib/ui-feedback";
import RichTextEditor from "../rich-text/RichTextEditor";
import KnowledgeTools from "./KnowledgeTools";

export function downloadNote(title: string, body: string, extension = "md") {
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "ノート"}.${extension}`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Draft = { title: string; doc: RichTextDoc };
const fingerprint = (draft: Draft) => JSON.stringify([draft.title.trim(), draft.doc]);

export default function KnowledgeComposer({ note, projectId, viewerId, template, links, guardRef, onSaved, onClose }: {
  note: ProjectKnowledge | null; projectId: number; viewerId: number; template?: string;
  links: { title: string; href: string }[];
  guardRef: MutableRefObject<(() => Promise<boolean>) | null>;
  onSaved: (note: ProjectKnowledge) => void; onClose: () => void;
}) {
  const storageKey = `atlas:knowledge-draft:${viewerId}:${projectId}:${note?.id ?? "new"}`;
  const [seed] = useState(() => {
    const original: Draft = { title: note?.title ?? "無題のノート", doc: note?.body_doc ?? markdownToDoc(note?.body ?? template ?? "") };
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const recovery = JSON.parse(raw);
        if (typeof recovery.draft?.title === "string" && typeof recovery.saved?.title === "string" &&
          typeof recovery.createKey === "string" && (!note || recovery.record?.id === note.id) &&
          (!recovery.record || (Number.isSafeInteger(recovery.record.id) && Number.isSafeInteger(recovery.record.revision)))) {
          validateKnowledgeDoc(recovery.draft.doc);
          validateKnowledgeDoc(recovery.saved.doc);
          return { draft: recovery.draft as Draft, saved: recovery.saved as Draft,
            record: recovery.record as ProjectKnowledge | null, createKey: recovery.createKey, recovered: true };
        }
      }
    } catch { /* A corrupt or unavailable browser draft never replaces server data. */ }
    return { draft: original, saved: original, record: note, createKey: crypto.randomUUID(), recovered: false };
  });
  const initial = seed.draft;
  const [draft, setDraft] = useState(initial);
  const latest = useRef(initial);
  const saved = useRef(seed.saved);
  const record = useRef(seed.record);
  const [hasRecord, setHasRecord] = useState(!!seed.record);
  const pending = useRef<Promise<boolean> | null>(null);
  const createAttempt = useRef<Draft | null>(null);
  const createKey = useRef(seed.createKey);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving" | "error">(seed.recovered ? "dirty" : "saved");
  const [error, setError] = useState("");
  const blocked = useRef(false);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  const dirty = useCallback(() => fingerprint(latest.current) !== fingerprint(saved.current), []);

  const persist = useCallback(() => {
    try {
      if (!dirty()) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify({ draft: latest.current, saved: saved.current, record: record.current, createKey: createKey.current }));
    } catch { /* The in-memory draft and unload guard still work without storage. */ }
  }, [dirty, storageKey]);

  const save = useCallback((force = false): Promise<boolean> => {
    if (pending.current) return pending.current;
    const run = async () => {
      if (!force && !dirty()) return true;
      blocked.current = false; setError(""); setStatus("saving");
      try {
        do {
          const current = record.current;
          if (!current && !createAttempt.current) createAttempt.current = latest.current;
          const snapshot = current ? latest.current : createAttempt.current!;
          if (!snapshot.title.trim()) throw new Error("タイトルを入力してください");
          const changedBody = !current || JSON.stringify(snapshot.doc) !== JSON.stringify(saved.current.doc);
          persist();
          const response = await fetch(current ? `/api/knowledge/${current.id}` : "/api/knowledge", {
            method: current ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: snapshot.title.trim(),
              ...(changedBody ? { body_doc: snapshot.doc } : {}),
              ...(current ? { expected_revision: current.revision } : { project_id: projectId, create_key: createKey.current }),
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? `保存できませんでした (${response.status})`);
          record.current = result; setHasRecord(true);
          // A retried POST may return an earlier successful creation after its
          // response was lost. Keep newer local typing dirty and save it next.
          const creationMatches = current || (result.title === snapshot.title.trim() && result.body_doc &&
            JSON.stringify(validateKnowledgeDoc(result.body_doc)) === JSON.stringify(validateKnowledgeDoc(snapshot.doc)));
          saved.current = creationMatches ? snapshot : { title: result.title, doc: result.body_doc ?? markdownToDoc(result.body) };
          onSavedRef.current(result); persist();
          if (!current && !creationMatches && result.revision > 0) throw new Error("作成済みのノートが別の画面で更新されています。変更を退避してから最新版を確認してください");
        } while (dirty());
        setStatus("saved"); return true;
      } catch (error) {
        blocked.current = true; setStatus("error"); persist();
        setError(error instanceof Error ? error.message : "保存できませんでした。変更はこの画面に残っています");
        return false;
      }
    };
    const promise = run().finally(() => { pending.current = null; });
    pending.current = promise;
    return promise;
  }, [dirty, persist, projectId]);

  useEffect(() => {
    if (!dirty() || blocked.current) return;
    const timer = setTimeout(() => { void save(); }, 1000);
    return () => clearTimeout(timer);
  }, [draft, dirty, save]);

  useEffect(() => {
    const flush = () => save(); guardRef.current = flush;
    const unload = (event: BeforeUnloadEvent) => { if (dirty() || pending.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (!dirty() && !pending.current)) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;
      event.preventDefault(); event.stopPropagation();
      void save().then(ok => { if (ok) window.location.assign(link.href); });
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { if (guardRef.current === flush) guardRef.current = null; window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty, guardRef, save]);

  const change = (next: Draft) => { latest.current = next; setDraft(next); persist(); if (!blocked.current) setStatus("dirty"); };
  return <div data-knowledge-composer className="min-w-0">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
      <p role="status" data-knowledge-save-status className={`text-xs ${status === "error" ? "text-red-700" : "text-secondary"}`}>
        {status === "saving" ? "保存中…" : status === "dirty" ? "未保存の変更" : status === "error" ? "保存できていません" : hasRecord ? "すべての変更を保存しました" : "新しいノート"}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={async () => { if (await save()) { try { sessionStorage.removeItem(storageKey); } catch {} onClose(); } }} className="rounded px-3 py-2 text-xs hover:bg-hover">編集を終了</button>
        <button type="button" data-knowledge-save disabled={status === "saving"} onClick={() => void save(!record.current)} className="rounded bg-accent px-3 py-2 text-xs font-medium text-on-accent disabled:opacity-50">{status === "saving" ? "保存中…" : "今すぐ保存"}</button>
      </div>
    </div>
    {error && <div role="alert" className="mb-4 rounded-md border border-red-200 bg-danger-soft p-3 text-sm text-red-800">
      <p>{error}</p><p className="mt-1">未保存の変更はこの画面に残っています。</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button onClick={() => void save(true)} className="underline">再試行</button>
        <button onClick={() => downloadNote(draft.title, JSON.stringify(draft.doc, null, 2), "json")} className="underline">変更をファイルに退避</button>
        <button onClick={async () => { if (await confirmAction("未保存の変更を破棄して編集を終了しますか？必要な変更は先にファイルへ退避してください。")) { try { sessionStorage.removeItem(storageKey); } catch {} onClose(); } }} className="underline">変更を破棄して終了</button>
      </div>
    </div>}
    {seed.recovered && <p className="mb-3 text-xs text-accent-text">このタブに残っていた未保存の下書きを復元しました。</p>}
    {note && !note.body_doc && <p className="mb-4 text-xs text-secondary">本文を編集するとブロック形式で保存します。元のMarkdownは履歴から復元できます。</p>}
    <input data-knowledge-title aria-label="ノートのタイトル" maxLength={300} value={draft.title} onChange={e => change({ ...latest.current, title: e.target.value })} placeholder="無題のノート" className="mb-4 w-full min-w-0 border-0 bg-transparent text-2xl font-semibold tracking-tight text-text outline-none placeholder:text-neutral-600" />
    {editor && <KnowledgeTools editor={editor} links={links} />}
    <RichTextEditor initialDoc={initial.doc} extraExtensions={knowledgeExtensions} borderless minHeightClass="min-h-[320px]"
      ariaLabel="ノートの本文" dataAttributes={{ "data-knowledge-body": "" }} placeholder="書き始めるか、/ でブロックを選択"
      onReady={setEditor} onChange={doc => change({ ...latest.current, doc })} onSubmit={() => save(true).then(() => undefined)} className="knowledge-document" />
    <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-line-subtle pt-3 text-xs text-secondary">
      <span>/ で挿入 · Alt+↑↓ でブロック移動 · ⌘/Ctrl+Enter で保存</span>
      <button onClick={() => downloadNote(draft.title, knowledgeMarkdown(draft.doc))} className="underline">Markdownを書き出す</button>
    </div>
  </div>;
}
