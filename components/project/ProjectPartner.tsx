"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { partnerPlainText, partnerSkills, type PartnerResponse, type PartnerSkill } from "@/lib/project-partner";
import KnowledgeActionMenu, { KnowledgeIcon, knowledgeAction, knowledgeMenuItem } from "../knowledge/KnowledgeActionMenu";

import PartnerActionApproval from "./PartnerActionApproval";
import PartnerReportFeed, { usePartnerReports } from "./PartnerReportFeed";

type Note = { id: number; revision: number };
export function useProjectPartner(projectId: number) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false), [savedReportId, setSavedReportId] = useState(0);
  const [skill, setSkill] = useState<PartnerSkill>("project_status");
  const [result, setResult] = useState<PartnerResponse | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null), pending = useRef(false);
  const last = useRef<{ skill: PartnerSkill; note?: Note }>({ skill: "project_status" });
  useEffect(() => () => controller.current?.abort(), []);
  const generate = async (next: PartnerSkill, note?: Note) => {
    if (pending.current || approving) return;
    pending.current = true; last.current = { skill: next, note };
    setOpen(true); setBusy(true); setSkill(next); setResult(null); setError(""); setNotice("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch(`/api/projects/${projectId}/partner`, { method: "POST", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill: next, request_id: crypto.randomUUID(), ...(note ? { note_id: note.id, expected_revision: note.revision } : {}) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "提案を生成できませんでした");
      if (!abort.signal.aborted) { setResult(value); if (value.report_id) setSavedReportId(value.report_id); }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "提案を生成できませんでした"); }
    finally { if (controller.current === abort) { pending.current = false; if (!abort.signal.aborted) setBusy(false); } }
  };
  const cancel = () => { controller.current?.abort(); pending.current = false; setBusy(false); setNotice("生成を中止しました。"); };
  return { projectId, open, busy, approving, locked: busy || approving, setApproving, savedReportId, skill, result, error, notice, generate, cancel,
    close: () => { if (approving) return; if (busy) cancel(); setOpen(false); }, show: () => setOpen(true),
    showResult: (value: PartnerResponse) => { if (busy || approving) return; setResult(value); setSkill(value.skill); last.current = { skill: value.skill }; setOpen(true); setError(""); setNotice(""); },
    retry: () => generate(last.current.skill, last.current.note),
    copy: () => { if (result) void navigator.clipboard.writeText(partnerPlainText(result)).then(() => setNotice("コピーしました"), () => setError("コピーできませんでした。結果を選択してコピーしてください")); },
  };
}
type Partner = ReturnType<typeof useProjectPartner>;
const date = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export function ProjectPartnerPanel({ partner: p, onClose, canEdit = true }: { partner: Partner; onClose?: () => void; canEdit?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const close = () => { if (p.approving) return; p.close(); onClose?.(); }, r = p.result;
  const sourceLink = (id: string) => { const source = r?.sources.find(s => s.id === id); return source ? <a key={id} href={source.href} className="inline-block rounded text-xs text-[#24529c] underline underline-offset-2">{source.label}</a> : null; };
  return <section aria-label="プロジェクトパートナーの提案" data-project-partner-panel className="min-w-0 border-t border-line pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 ref={heading} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold outline-none"><KnowledgeIcon name="ai" />プロジェクトパートナー</h2>
      <button className={`${knowledgeAction} size-8 shrink-0 border-transparent px-0`} aria-label="提案を閉じる" disabled={p.approving} onClick={close}><KnowledgeIcon name="close" /></button>
    </div>
    <p className="text-sm font-medium text-[#24529c]">{partnerSkills[p.skill]}</p>
    <p className="mt-2 mb-5 text-xs leading-5 text-secondary">{p.skill === "action_extract" ? "候補の内容を確認し、承認するとタスクを追加できます。" : "生成した報告は、概要ページの履歴に保存されます。"}</p>
    {p.busy && <div role="status" className="space-y-3"><p className="text-sm text-secondary">内容を確認しています…</p><div aria-hidden className="h-3 rounded bg-surface-muted motion-safe:animate-pulse" /><button className={knowledgeAction} onClick={p.cancel}>中止</button></div>}
    {p.error && <p role="alert" className="mb-3 text-sm text-red-700">{p.error}</p>}
    {p.notice && <p role="status" className="mb-3 text-sm text-secondary">{p.notice}</p>}
    {canEdit && !r && !p.busy && <button className={knowledgeAction} onClick={() => void p.retry()}>もう一度生成</button>}
    {r && <div data-partner-result className="space-y-5 break-words text-sm leading-7">
      <div className="text-xs leading-5 text-secondary"><p>確認時点：{date(r.checked_at)}（日本時間）</p>{r.skill === "weekly_report" && <p>対象期間：{date(r.period_start)} 〜 {date(r.checked_at)}（過去7日間）</p>}
        <p>参照：ノート {r.coverage.notes}/{r.coverage.total_notes}・タスク {r.coverage.tasks}/{r.coverage.total_tasks}・コメント {r.coverage.comments}/{r.coverage.total_comments}・依存関係 {r.coverage.dependencies}/{r.coverage.total_dependencies}</p>
        {r.coverage.partial && <p className="mt-2 text-warning">参照は一部です。未参照の内容は判断対象に含まれません。</p>}
      </div>
      {r.facts && <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-surface-subtle p-3 text-xs">{([
        ["タスク総数", r.facts.total], ["完了", r.facts.completed], ["期限超過", r.facts.overdue], ["担当者未設定", r.facts.unassigned], ["過去7日間の完了", r.facts.completed_in_period], ["過去7日間の新規", r.facts.created_in_period],
      ] as const).map(([label, value]) => <div key={label}><dt className="text-secondary">{label}</dt><dd className="text-base font-semibold">{value}</dd></div>)}</dl>}
      <p data-partner-summary className="whitespace-pre-wrap">{r.summary}</p>
      {r.sections.map((section, index) => <div key={index}><h3 className="mb-2 font-semibold">{section.heading}</h3><ul className="space-y-3">{section.items.map((item, i) => <li key={i}><p className="whitespace-pre-wrap">{item.text}</p><div className="flex flex-wrap gap-x-3">{item.source_ids.map(sourceLink)}</div></li>)}</ul></div>)}
      {r.skill === "action_extract" && <div><h3 className="mb-3 font-semibold">アクション候補</h3>{r.action_batch_id ? <PartnerActionApproval key={r.action_batch_id} projectId={p.projectId} batchId={r.action_batch_id} actions={r.actions} onCommitting={p.setApproving} /> : <p className="text-secondary">タスクを追加するには、もう一度アクションを抽出してください。</p>}</div>}
      {!!r.questions.length && <div><h3 className="mb-2 font-semibold">確認したいこと</h3><ul className="list-disc space-y-2 pl-5">{r.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
      <div className="flex flex-wrap gap-2"><button className={knowledgeAction} onClick={p.copy}><KnowledgeIcon name="copy" />コピー</button>{canEdit && <button className={knowledgeAction} disabled={p.approving} onClick={() => void p.retry()}>再生成</button>}</div>
      <details className="border-t border-line-subtle pt-3 text-xs text-secondary"><summary className="cursor-pointer">参照元を確認</summary><ul className="mt-3 space-y-3">{r.sources.map(s => <li key={s.id}>{sourceLink(s.id)}<p className="whitespace-pre-wrap">{s.excerpt}</p></li>)}</ul></details>
    </div>}
  </section>;
}

export default function ProjectPartnerWorkspace({ projectId, canEdit, children }: { projectId: number; canEdit: boolean; children: ReactNode }) {
  const partner = useProjectPartner(projectId), toolbar = useRef<HTMLDivElement>(null), id = useId();
  const [view, setView] = useState<"overview" | "reports">("overview");
  const reports = usePartnerReports(projectId, partner.savedReportId, partner.locked, partner.showResult);
  const tabs = ["overview", "reports"] as const;
  const choose = (next: typeof view) => { if (partner.locked || reports.busy !== null) return; partner.close(); setView(next); };
  const focusTab = (next: typeof view) => document.getElementById(`${id}-${next}-tab`)?.focus();
  const generate = (skill: "project_status" | "weekly_report") => { setView("reports"); void partner.generate(skill); };
  const latest = reports.items[0];
  return <div data-overview-workspace className="mx-auto max-w-7xl px-4 pb-16 sm:px-7">
    <div ref={toolbar} className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4 pt-2">
      <div role="tablist" aria-label="概要の表示" className="flex min-w-0 items-center gap-1">
        {tabs.map(tab => <button key={tab} type="button" role="tab" id={`${id}-${tab}-tab`} aria-controls={`${id}-${tab}-panel`} aria-selected={view === tab} tabIndex={view === tab ? 0 : -1}
          disabled={partner.locked || reports.busy !== null} onClick={() => choose(tab)}
          className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 ${view === tab ? "bg-blue-50 text-[#24529c]" : "text-secondary hover:bg-neutral-50"}`}
          onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? "overview" : e.key === "End" ? "reports" : tab === "overview" ? "reports" : "overview"; choose(next); focusTab(next); } }}>
          {tab === "overview" ? "全体像" : <>報告履歴{!reports.error && !reports.loading && reports.total > 0 && <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs tabular-nums text-secondary">{reports.total}</span>}</>}
        </button>)}
      </div>
      {canEdit && <KnowledgeActionMenu label="プロジェクトパートナー" disabled={partner.locked || reports.busy !== null} className={`${knowledgeAction} border-blue-200 text-[#24529c] hover:bg-blue-50`}
        icon={<><KnowledgeIcon name="ai" /><span>プロジェクトパートナー</span><KnowledgeIcon name="chevron" /></>}>
        <button role="menuitem" className={knowledgeMenuItem} onClick={() => generate("project_status")}><KnowledgeIcon name="summary" />状況を確認</button>
        <button role="menuitem" className={knowledgeMenuItem} onClick={() => generate("weekly_report")}><KnowledgeIcon name="history" />週次報告を作成</button>
      </KnowledgeActionMenu>}
    </div>
    <div className={`grid min-w-0 gap-7 ${partner.open ? "xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]" : "grid-cols-1"}`}>
      <div className="min-w-0">
        <div role="tabpanel" id={`${id}-overview-panel`} aria-labelledby={`${id}-overview-tab`} hidden={view !== "overview"} tabIndex={0} className="outline-blue-600">
          {children}
          <div data-overview-latest-report className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4 text-xs text-secondary">
            <KnowledgeIcon name="history" />
            {reports.loading ? <span role="status">報告を読み込み中…</span> : reports.error ? <><span role="alert">報告を読み込めませんでした。</span><button className="rounded text-[#24529c] underline" onClick={reports.reload}>再読み込み</button></> : latest ? <>
              <span>最新の{partnerSkills[latest.skill]} · {date(latest.created_at)}</span>
              <button className="rounded py-1 text-[#24529c] underline underline-offset-4 disabled:opacity-50" disabled={partner.locked || reports.busy !== null} onClick={() => { setView("reports"); void reports.open(latest.id); }}>報告を読む</button>
            </> : <span>状況確認や週次報告は、生成すると報告履歴に保存されます。</span>}
          </div>
        </div>
        <div role="tabpanel" id={`${id}-reports-panel`} aria-labelledby={`${id}-reports-tab`} hidden={view !== "reports"} tabIndex={0} className="outline-blue-600">
          <PartnerReportFeed reports={reports} canEdit={canEdit} disabled={partner.locked} />
        </div>
      </div>
      {partner.open && <ProjectPartnerPanel partner={partner} canEdit={canEdit} onClose={() => { const trigger = toolbar.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]'); if (trigger) trigger.focus(); else focusTab(view); }} />}
    </div>
  </div>;
}
