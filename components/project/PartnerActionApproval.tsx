"use client";
import { useEffect, useRef, useState } from "react";
import type { PartnerAction } from "@/lib/project-partner";
import { explicitActionDate, type ActionOptions, type ApprovalSelection, type ApprovedAction } from "@/lib/partner-workflows";
import { knowledgeAction, knowledgePrimaryAction } from "../knowledge/KnowledgeActionMenu";

type Draft = { title: string; assignee: string; due: string; section: string };
const inputClass = "mt-1 block w-full min-w-0 rounded-md border border-line-strong bg-field px-2.5 py-2 text-sm text-text focus:outline-focus-ring disabled:bg-surface-subtle";
export default function PartnerActionApproval({ projectId, batchId, actions, onCommitting }: {
  projectId: number; batchId: string; actions: PartnerAction[]; onCommitting: (value: boolean) => void;
}) {
  const [options, setOptions] = useState<ActionOptions | null>(null), [reload, setReload] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>(() => actions.map(a => ({ title: a.title, assignee: "", due: explicitActionDate(a.due), section: "" })));
  const [selected, setSelected] = useState<number[]>([]), [review, setReview] = useState<ApprovalSelection[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const pending = useRef(false), initialized = useRef(false), reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/projects/${projectId}/partner/actions?batch_id=${encodeURIComponent(batchId)}`, { signal: abort.signal, cache: "no-store" })
      .then(async r => { const v = await r.json(); if (!r.ok) throw new Error(v.error ?? "候補を確認できませんでした"); return v as ActionOptions; })
      .then(v => { if (!abort.signal.aborted) {
        setOptions(v); setError("");
        if (!initialized.current) {
          initialized.current = true;
          setDrafts(old => old.map((d, i) => { const s = v.suggestions[i]; return { ...d, assignee: s?.assignee_id ? String(s.assignee_id) : "", due: s?.due_on ?? d.due, section: s?.section_id ? String(s.section_id) : "" }; }));
        }
      } })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "候補を確認できませんでした"); });
    return () => abort.abort();
  }, [projectId, batchId, reload, actions]);
  useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review]);
  const edit = (index: number, change: Partial<Draft>) => setDrafts(old => old.map((d, i) => i === index ? { ...d, ...change } : d));
  const confirm = () => {
    setError(""); setNotice("");
    if (!selected.length || !options) return;
    for (const index of selected) {
      const d = drafts[index];
      if (!d.title.trim() || !d.assignee || !explicitActionDate(d.due)) { setError(`候補${index + 1}のタスク名・担当者・具体的な期限を確認してください。`); return; }
    }
    setReview(selected.map(index => ({ index, title: drafts[index].title.trim(), assignee_id: Number(drafts[index].assignee), due_on: drafts[index].due, section_id: drafts[index].section ? Number(drafts[index].section) : null })));
  };
  const approve = async () => {
    if (!review || pending.current) return;
    pending.current = true; setBusy(true); onCommitting(true); setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/partner/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_id: batchId, confirmed: true, actions: review }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "追加できませんでした");
      setOptions(previous => previous ? { ...previous, approved: value.approved as ApprovedAction[] } : previous);
      setNotice(value.created_count ? `${value.created_count}件のタスクを追加しました。` : "選択した候補は追加済みです。");
      setSelected([]); setReview(null);
    } catch (e) { setError(e instanceof Error ? e.message : "追加できませんでした。内容を保持したまま再試行できます。"); }
    finally { pending.current = false; setBusy(false); onCommitting(false); }
  };
  if (!actions.length) return <p className="text-secondary">明示されたアクションはありません。</p>;
  return <div data-partner-approval className="space-y-4">
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {!options && !error && <p role="status" className="text-sm text-secondary">担当者・セクションを読み込み中…</p>}
    {!options && error && <button className={knowledgeAction} onClick={() => setReload(v => v + 1)}>もう一度読み込む</button>}
    {review ? <div className="space-y-4" data-partner-approval-review>
      <h3 ref={reviewHeading} tabIndex={-1} className="font-semibold outline-none">追加内容の確認</h3>
      <p className="text-xs text-secondary">追加先：{options?.project_name}</p>
      <ul className="divide-y divide-line">{review.map(a => <li key={a.index} className="py-3"><p className="font-medium">{a.title}</p><p className="text-xs text-secondary">{options?.members.find(m => m.id === a.assignee_id)?.name} · {a.due_on}</p><p className="text-xs text-secondary">{options?.sections.find(s => s.id === a.section_id)?.name ?? "セクションなし"}</p></li>)}</ul>
      <p className="text-xs leading-5 text-secondary">承認すると、この内容でタスクを追加します。通常のタスク追加と同じ通知・自動化が適用されます。</p>
      <div className="flex flex-wrap gap-2"><button disabled={busy} className={knowledgeAction} onClick={() => { setReview(null); setError(""); }}>内容を修正</button><button disabled={busy} className={knowledgePrimaryAction} onClick={() => void approve()}>{busy ? "追加中…" : `承認して${review.length}件を追加`}</button></div>
    </div> : <>
      <p className="text-xs text-secondary">追加したい候補を選び、入力済みの担当者・期限・セクションを確認してください。内容は修正できます。</p>
      <ol className="divide-y divide-line">{actions.map((a, index) => {
        const approved = options?.approved.find(v => v.index === index), checked = selected.includes(index), d = drafts[index], suggestion = options?.suggestions[index];
        return <li key={index} data-partner-action className="space-y-3 py-4 first:pt-0">
          <div className="flex items-start gap-2">{!approved && <input aria-label={`候補${index + 1}を選択`} type="checkbox" disabled={!options} checked={checked} className="mt-2 size-4 accent-accent" onChange={e => setSelected(old => e.target.checked ? [...old, index].sort((a,b) => a-b) : old.filter(i => i !== index))} />}<p className="min-w-0 flex-1 font-medium">{approved?.title ?? a.title}</p></div>
          {approved ? <p className="text-xs text-success">{approved.task_id ? <a href={`/projects/${projectId}?view=list&task=${approved.task_id}`} className="underline underline-offset-2">追加済み · タスクを開く</a> : "追加済み（現在はタスクを参照できません）"}</p> : checked ? <fieldset className="space-y-3" disabled={busy}>
            <label className="block text-xs text-secondary">タスク名<input aria-label={`候補${index + 1}のタスク名`} maxLength={300} className={inputClass} value={d.title} onChange={e => edit(index, { title: e.target.value })} /></label>
            <label className="block text-xs text-secondary">担当者<select aria-label={`候補${index + 1}の担当者`} className={inputClass} value={d.assignee} onChange={e => edit(index, { assignee: e.target.value })}><option value="">担当者を選択</option>{options?.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><span className="mt-1 block text-secondary">ノートの記載：{a.assignee ?? "要確認"}</span></label>
            <label className="block text-xs text-secondary">期限<input aria-label={`候補${index + 1}の期限`} type="date" min="0001-01-01" max="9999-12-31" className={inputClass} value={d.due} onChange={e => edit(index, { due: e.target.value })} /><span className="mt-1 block text-secondary">ノートの記載：{a.due ?? "要確認"}</span>{suggestion?.date_reason && d.due === suggestion.due_on && <span className="mt-1 block leading-5 text-secondary">{suggestion.date_reason}</span>}</label>
            <label className="block text-xs text-secondary">セクション<select aria-label={`候補${index + 1}のセクション`} className={inputClass} value={d.section} onChange={e => edit(index, { section: e.target.value })}><option value="">セクションなし</option>{options?.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{suggestion?.section_reason && d.section === String(suggestion.section_id) && <span className="mt-1 block leading-5 text-secondary">提案理由：{suggestion.section_reason}</span>}</label>
          </fieldset> : <p className="text-xs leading-5 text-secondary">担当者：{options?.members.find(m => String(m.id) === d.assignee)?.name ?? a.assignee ?? "要確認"} ／ 期限：{d.due || a.due || "要確認"}{d.section && <> ／ {options?.sections.find(s => String(s.id) === d.section)?.name}</>}</p>}
          <details className="text-xs leading-6 text-secondary"><summary className="cursor-pointer">ノートの根拠を確認</summary><blockquote className="mt-2 whitespace-pre-wrap">{a.evidence}</blockquote><a href={`/projects/${projectId}?view=knowledge&note=${a.source_id.slice(1)}`} className="text-accent-text underline">元ノートを開く</a></details>
        </li>;
      })}</ol>
      {!!selected.length && <button className={knowledgePrimaryAction} onClick={confirm}>選択した{selected.length}件を確認</button>}
    </>}
  </div>;
}
