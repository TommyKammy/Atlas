"use client";
import { useEffect, useRef, useState } from "react";
import type { ProjectKnowledge } from "@/lib/data";

type Connection = { id: string; revision: number; name: string; model: string; local: boolean; max_input_chars: number };
type Result = { text: string; token: string; source_text: string; source_revision: number; stale: boolean; model: string; operation: string };
const button = "rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50";
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init), value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "操作できませんでした");
  return value;
}
export default function KnowledgeAi({ note, onSaved }: { note: ProjectKnowledge; onSaved: (note: ProjectKnowledge) => void }) {
  const [open, setOpen] = useState(false), [connections, setConnections] = useState<Connection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [title, setTitle] = useState("");
  const pending = useRef(false), controller = useRef<AbortController | null>(null);
  const endpoint = `/api/knowledge/${note.id}/ai`;
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    api(endpoint, { signal: abort.signal }).then((items: Connection[]) => {
      setConnections(items); setLoaded(true);
    }).catch(e => { if (!abort.signal.aborted) { setError(e.message); setLoaded(true); } });
    return () => abort.abort();
  }, [open, endpoint]);
  const selected = connections[0];
  const generate = async (operation: "summary" | "improve") => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice(""); setResult(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const value = await api(endpoint, { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: selected?.id, connection_revision: selected?.revision, expected_revision: note.revision, request_id: crypto.randomUUID(), operation }) });
      if (!abort.signal.aborted) { setResult(value); setTitle(`${note.title.slice(0, 280)}（${operation === "summary" ? "要約" : "文章改善案"}）`); }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "生成できませんでした"); }
    finally { pending.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!result || pending.current) return;
    pending.current = true; setSaving(true); setError("");
    try {
      const created = await api(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: result.token, title }) });
      onSaved(created);
    } catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした"); }
    finally { pending.current = false; setSaving(false); }
  };
  return <section className="my-5 rounded-lg border border-neutral-200" aria-label="ノートのAIアシスト">
    <button className="w-full px-4 py-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-blue-600" aria-expanded={open} onClick={() => setOpen(v => !v)}>AIアシスト {open ? "▴" : "▾"}</button>
    {open && <div className="space-y-4 border-t border-neutral-200 p-4">
      {!loaded ? <p role="status" className="text-sm">準備中…</p> : connections.length === 0 ? <p className="text-sm text-neutral-600">このノートではAIアシストを利用できません。管理者にお問い合わせください。</p> : <>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || saving || !selected} onClick={() => void generate("summary")}>要約を生成</button>
          <button className={button} disabled={busy || saving || !selected} onClick={() => void generate("improve")}>文章改善案を生成</button>
          {busy && <button className={button} onClick={() => { controller.current?.abort(); setNotice("生成を中止しました。"); }}>中止</button>}
        </div>
      </>}
      {busy && <p role="status" className="text-sm text-neutral-600">生成中…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-neutral-600">{notice}</p>}
      {result && <div className="space-y-4" data-ai-result>
        <p className="text-xs text-neutral-600">保存期限：生成から1時間</p>
        {result.stale && <p role="alert" className="text-sm text-amber-800">生成中に元ノートが更新されました。この結果は更新前の内容に基づいています。</p>}
        <div className="grid gap-4 xl:grid-cols-2">
          <details className="min-w-0"><summary className="cursor-pointer text-sm font-medium">元の文章を確認</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{result.source_text}</pre></details>
          <div className="min-w-0"><h3 className="text-sm font-medium">{result.operation === "summary" ? "要約" : "文章改善案と改善ポイント"}</h3><pre data-ai-output className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 font-sans text-sm leading-relaxed">{result.text}</pre></div>
        </div>
        <label className="block text-sm">別ノートのタイトル<input aria-label="別ノートのタイトル" maxLength={300} className="mt-1 block w-full rounded border border-neutral-300 p-2" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <button className={button} onClick={() => void navigator.clipboard.writeText(result.text).then(() => setNotice("コピーしました"), () => setError("コピーできませんでした。生成結果を選択してコピーしてください"))}>コピー</button>
          <button className={`${button} bg-blue-50`} disabled={saving || !title.trim()} onClick={() => void save()}>{saving ? "保存中…" : "別ノートとして保存"}</button>
          <button className={button} disabled={saving} onClick={() => { setResult(null); setNotice(""); }}>結果を破棄</button>
        </div>
      </div>}
    </div>}
  </section>;
}
