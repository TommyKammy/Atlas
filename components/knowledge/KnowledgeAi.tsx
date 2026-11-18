"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ProjectKnowledge } from "@/lib/data";
import { renderMarkdown } from "@/lib/markdown";
import KnowledgeActionMenu, { KnowledgeIcon, knowledgeAction, knowledgeActionBase, knowledgePrimaryAction, knowledgeMenuItem } from "./KnowledgeActionMenu";

import { ProjectPartnerPanel, useProjectPartner } from "../project/ProjectPartner";

type Operation = "summary" | "improve";
type Connection = { id: string; revision: number };
type Result = { text: string; token: string; source_text: string; source_revision: number; stale: boolean; operation: Operation };
type Proposal = { result: Result; title: string };
const labels = { summary: "要約", improve: "文章改善案" };
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init), value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "操作できませんでした");
  return value;
}

export default function KnowledgeAi({ projectId, note, onSaved, enabled = true, children }: {
  projectId: number; note: ProjectKnowledge; onSaved: (note: ProjectKnowledge) => void; enabled?: boolean;
  children: (trigger: ReactNode, panel: ReactNode) => ReactNode;
}) {
  const partner = useProjectPartner(projectId);
  const [open, setOpen] = useState(false), [connections, setConnections] = useState<Connection[]>([]);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<Operation>("summary");
  const [proposals, setProposals] = useState<Partial<Record<Operation, Proposal>>>({});
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const pending = useRef(false), controller = useRef<AbortController | null>(null), configController = useRef<AbortController | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null), triggerContainer = useRef<HTMLSpanElement>(null);
  const id = useId(), endpoint = `/api/knowledge/${note.id}/ai`;
  useEffect(() => () => { controller.current?.abort(); configController.current?.abort(); }, []);
  useEffect(() => { if (open) panelHeading.current?.focus(); }, [open]);
  const selected = connections[0], proposal = proposals[operation], result = proposal?.result;
  const load = async () => {
    configController.current?.abort();
    const abort = new AbortController(); configController.current = abort;
    setLoading(true); setError("");
    try {
      const items = await api(endpoint, { signal: abort.signal });
      if (!abort.signal.aborted) { setConnections(items); setLoaded(true); }
    } catch (e) { if (!abort.signal.aborted) { setConnections([]); setError(e instanceof Error ? e.message : "準備できませんでした"); setLoaded(true); } }
    finally { if (!abort.signal.aborted) setLoading(false); }
  };
  const generate = async (next: Operation) => {
    if (!selected || pending.current || loading || partner.locked) return;
    partner.close();
    setOperation(next); setOpen(true);
    pending.current = true; setBusy(true); setError(""); setNotice("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const value: Result = await api(endpoint, { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: selected.id, connection_revision: selected.revision, expected_revision: note.revision, request_id: crypto.randomUUID(), operation: next }) });
      if (!abort.signal.aborted) setProposals(previous => ({ ...previous, [next]: { result: value, title: `${note.title.slice(0, 280)}（${labels[next]}）` } }));
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "生成できませんでした"); }
    finally { if (!abort.signal.aborted) setBusy(false); pending.current = false; }
  };
  const cancel = () => { controller.current?.abort(); setBusy(false); setNotice("生成を中止しました。"); };
  const closePanel = () => { if (saving) return; if (busy) cancel(); setOpen(false); triggerContainer.current?.querySelector<HTMLButtonElement>("button")?.focus(); };
  const save = async () => {
    if (!proposal || pending.current) return;
    pending.current = true; setSaving(true); setError("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const created = await api(endpoint, { method: "PUT", signal: abort.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: proposal.result.token, title: proposal.title }) });
      if (!abort.signal.aborted) onSaved(created);
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "保存できませんでした"); }
    finally { pending.current = false; if (!abort.signal.aborted) setSaving(false); }
  };
  const switchOperation = (next: Operation) => { setOperation(next); setError(""); setNotice(""); };
  const trigger = enabled ? <span ref={triggerContainer} className="inline-flex">
    <KnowledgeActionMenu label="AIアシスト" onOpen={() => void load()} className={`${knowledgeActionBase} border-accent-line bg-blue-50 text-accent-text hover:bg-blue-100`}
      icon={<><KnowledgeIcon name="ai" /><span>AIアシスト</span><KnowledgeIcon name="chevron" /></>}>
        {loading && <p role="status" className="px-3 py-2 text-sm text-secondary">準備中…</p>}
        {error && !open && <p role="alert" className="px-3 py-2 text-sm text-danger">{error}</p>}
        {loaded && !loading && !selected && !error && <p className="px-3 py-2 text-sm text-secondary">このノートではAIアシストを利用できません。管理者にお問い合わせください。</p>}
        {(["summary", "improve"] as const).map(kind => <button key={kind} role="menuitem" className={knowledgeMenuItem} disabled={!loaded || loading || !selected || busy || saving || partner.locked} onClick={() => void generate(kind)}><KnowledgeIcon name={kind === "summary" ? "summary" : "edit"} />{labels[kind]}を生成</button>)}
        <p className="mt-1 border-t border-line-subtle px-3 pt-3 pb-1 text-xs text-muted">プロジェクトパートナー</p>
        <button role="menuitem" className={knowledgeMenuItem} disabled={!loaded || loading || !selected || busy || saving || partner.locked} onClick={() => { setOpen(false); void partner.generate("action_extract", note); }}><KnowledgeIcon name="summary" />アクションを抽出</button>
        {partner.result && !partner.open && <button role="menuitem" className={knowledgeMenuItem} onClick={() => { setOpen(false); partner.show(); }}>アクション候補を表示</button>}
        {(busy || Object.values(proposals).some(Boolean)) && <button role="menuitem" className={`${knowledgeMenuItem} border-t border-line-subtle`} disabled={partner.locked} onClick={() => { partner.close(); setOpen(true); }}>結果パネルを表示</button>}
    </KnowledgeActionMenu>
  </span> : null;
  const panel = enabled && open ? <section aria-label="ノートのAIアシスト" data-ai-panel className="min-w-0 border-t border-line pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closePanel(); } }}>
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 ref={panelHeading} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold outline-none"><KnowledgeIcon name="ai" />AIアシスト</h2>
      <button className={`${knowledgeAction} size-8 border-transparent px-0`} aria-label="AIアシストを閉じる" disabled={saving} onClick={closePanel}><KnowledgeIcon name="close" /></button>
    </div>
    <div role="tablist" aria-label="AIアシストの操作" className="mb-5 flex border-b border-line">
      {(["summary", "improve"] as const).map(kind => <button key={kind} id={`${id}-${kind}`} role="tab" aria-selected={operation === kind} aria-controls={`${id}-result`} tabIndex={operation === kind ? 0 : -1} disabled={busy || saving}
        className={`-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-50 ${operation === kind ? "border-accent font-medium text-accent-text" : "border-transparent text-neutral-600 hover:text-neutral-900"}`}
        onClick={() => switchOperation(kind)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "summary" : event.key === "End" ? "improve" : kind === "summary" ? "improve" : "summary"; switchOperation(next); document.getElementById(`${id}-${next}`)?.focus(); } }}>{labels[kind]}</button>)}
    </div>
    <div id={`${id}-result`} role="tabpanel" aria-labelledby={`${id}-${operation}`} className="space-y-4">
      {busy && <div role="status" className="space-y-3 py-2"><p className="text-sm text-secondary">{labels[operation]}を生成中…</p><div aria-hidden="true" className="space-y-2 motion-safe:animate-pulse"><div className="h-3 rounded bg-surface-muted" /><div className="h-3 w-4/5 rounded bg-surface-muted" /><div className="h-3 w-3/5 rounded bg-surface-muted" /></div><button className={knowledgeAction} onClick={cancel}>中止</button></div>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
      {!result && !busy && <button className={knowledgeAction} disabled={!selected || loading || saving} onClick={() => void generate(operation)}>{labels[operation]}を生成</button>}
      {result && proposal && <div className="space-y-4" data-ai-result>
        {result.stale && <p role="alert" className="text-sm text-warning">生成中に元ノートが更新されました。この結果は更新前の内容に基づいています。</p>}
        <div data-ai-output className="atlas-rich-text max-h-[55vh] overflow-auto break-words text-sm leading-7 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-2 [&_ul]:my-2" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.text) }} />
        <div className="flex flex-wrap gap-2">
          <button className={knowledgeAction} onClick={() => void navigator.clipboard.writeText(result.text).then(() => setNotice("コピーしました"), () => setError("コピーできませんでした。生成結果を選択してコピーしてください"))}><KnowledgeIcon name="copy" />コピー</button>
          <button className={knowledgePrimaryAction} disabled={busy || saving || !proposal.title.trim()} onClick={() => void save()}>{saving ? "保存中…" : "別ノートとして保存"}</button>
        </div>
        <label className="block text-xs text-secondary">別ノートのタイトル<input aria-label="別ノートのタイトル" maxLength={300} disabled={saving} className="mt-1.5 block w-full rounded-md border border-line px-3 py-2 text-sm text-text focus:outline-focus-ring" value={proposal.title} onChange={event => setProposals(previous => ({ ...previous, [operation]: { ...proposal, title: event.target.value } }))} /></label>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <button className="rounded py-1 text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-50" disabled={busy || saving || loading} onClick={() => void generate(operation)}>再生成</button>
          <button className="rounded py-1 text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-50" disabled={busy || saving} onClick={() => { setProposals(previous => ({ ...previous, [operation]: undefined })); setNotice(""); }}>結果を破棄</button>
        </div>
        <details className="border-t border-line-subtle pt-3 text-xs text-secondary"><summary className="cursor-pointer">生成時の原文を確認</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans leading-6">{result.source_text}</pre><p className="mt-2">別ノートへの保存期限：生成から1時間</p></details>
      </div>}
    </div>
  </section> : null;
  return children(trigger, enabled && partner.open ? <ProjectPartnerPanel partner={partner} onClose={() => triggerContainer.current?.querySelector<HTMLButtonElement>("button")?.focus()} /> : panel);
}
