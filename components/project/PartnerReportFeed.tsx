"use client";
import { useEffect, useRef, useState } from "react";
import { partnerSkills, type PartnerResponse } from "@/lib/project-partner";
import type { PartnerReportDetail, PartnerReportSummary } from "@/lib/partner-workflows";
import { knowledgeAction } from "../knowledge/KnowledgeActionMenu";

const date = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: "no-store", ...init }), v = await r.json();
  if (!r.ok) throw new Error(v.error ?? "報告を読み込めませんでした"); return v;
}
export function usePartnerReports(projectId: number, refreshKey: number, disabled: boolean, onOpen: (result: PartnerResponse) => void) {
  const [items, setItems] = useState<PartnerReportSummary[]>([]), [cursor, setCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState<number | "more" | null>(null);
  const [error, setError] = useState(""), [reload, setReload] = useState(0);
  const revision = useRef(0), pending = useRef(false);
  const endpoint = `/api/projects/${projectId}/partner/reports`;
  useEffect(() => {
    const abort = new AbortController(); const version = ++revision.current;
    api(endpoint, { signal: abort.signal }).then(v => { if (!abort.signal.aborted && revision.current === version) { setItems(v.items); setTotal(v.total); setCursor(v.next_cursor); setError(""); } })
      .catch(e => { if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : "報告を読み込めませんでした"); setItems([]); setTotal(0); setCursor(null); } })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [endpoint, refreshKey, reload]);
  const run = async (key: number | "more", action: () => Promise<void>) => {
    if (pending.current || disabled) return; pending.current = true; setBusy(key); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "操作できませんでした"); }
    finally { pending.current = false; setBusy(null); }
  };
  const open = (id: number) => run(id, async () => { const detail = await api(`${endpoint}/${id}`) as PartnerReportDetail; onOpen(detail.result); });
  const review = (id: number) => run(id, async () => {
    const detail = await api(`${endpoint}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed: true }) }) as PartnerReportDetail;
    setItems(old => old.map(r => r.id === id ? detail.report : r));
  });
  const more = () => run("more", async () => {
    const version = revision.current, page = await api(`${endpoint}?before=${cursor}`);
    if (version !== revision.current) return;
    setItems(old => [...old, ...page.items.filter((r: PartnerReportSummary) => !old.some(v => v.id === r.id))]); setCursor(page.next_cursor);
  });
  return { items, total, cursor, loading, busy, error, open, review, more, reload: () => setReload(v => v + 1) };
}

export default function PartnerReportFeed({ reports, canEdit, disabled }: {
  reports: ReturnType<typeof usePartnerReports>; canEdit: boolean; disabled: boolean;
}) {
  const { items, cursor, loading, busy, error, open, review, more, reload } = reports;
  return <section aria-label="プロジェクトパートナーの報告" data-partner-report-feed className="max-w-4xl">
    <div className="mb-6"><h2 className="text-lg font-semibold">報告履歴</h2><p className="mt-1 text-sm text-secondary">状況確認と週次報告を、新しい順に表示しています。</p></div>
    {loading && <p role="status" className="py-4 text-sm text-secondary">報告を読み込み中…</p>}
    {error && <div className="mb-3 space-y-2"><p role="alert" className="text-sm text-red-700">{error}</p><button className={knowledgeAction} disabled={busy !== null || disabled} onClick={reload}>もう一度読み込む</button></div>}
    {!loading && !error && !items.length && <p className="rounded-lg border border-dashed border-line-strong p-5 text-sm leading-6 text-secondary">状況確認や週次報告を生成すると、ここに履歴が残ります。</p>}
    <ol className="divide-y divide-neutral-200 border-t border-neutral-200">{items.map(r => <li key={r.id}><article data-partner-report={r.id} className="py-6">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">{partnerSkills[r.skill]}</h3><p className="mt-1 text-xs leading-5 text-secondary"><time dateTime={r.created_at}>{date(r.created_at)}</time> · {r.creator_name ?? "退会ユーザー"} が生成</p></div><span className={`rounded px-2 py-1 text-xs ${r.reviewed_at ? "bg-green-50 text-green-800" : "bg-surface-muted text-neutral-700"}`}>{r.reviewed_at ? "確認済み" : "AI生成・未確認"}</span></header>
      {r.skill === "weekly_report" && <p className="mb-2 text-xs text-secondary">対象期間：{date(r.period_start)} 〜 {date(r.checked_at)}</p>}
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-7">{r.summary}</p>
      <footer className="mt-3 flex flex-wrap items-center gap-2"><button className={knowledgeAction} disabled={disabled || busy !== null} onClick={() => void open(r.id)}>報告を読む</button>
        {canEdit && !r.reviewed_at && <button className="rounded px-2 py-2 text-xs text-[#24529c] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50" disabled={disabled || busy !== null} onClick={() => void review(r.id)}>確認済みにする</button>}
        {r.reviewed_at && <p className="text-xs text-secondary">{r.reviewer_name ?? "退会ユーザー"} が {date(r.reviewed_at)} に確認</p>}
      </footer>
    </article></li>)}</ol>
    {cursor !== null && <button className={`${knowledgeAction} mt-4`} disabled={disabled || busy !== null} onClick={() => void more()}>{busy === "more" ? "読み込み中…" : "過去の報告を見る"}</button>}
  </section>;
}
