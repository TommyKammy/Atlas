"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { RuleEditorDraftSummary } from "@/lib/automation/editor-drafts";

type DraftListState = { projectId: number; generation: number } & (
  | { status: "loading" }
  | { status: "ready"; drafts: RuleEditorDraftSummary[] }
  | { status: "error" }
);

function updatedAtLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "更新日時不明" : new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export default function RuleDraftList({ projectId }: { projectId: number }) {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<DraftListState>({ projectId, generation: 0, status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void api<{ drafts: RuleEditorDraftSummary[] }>(`/api/projects/${projectId}/rules/drafts`, { signal: controller.signal })
      .then(({ drafts }) => {
        if (!controller.signal.aborted) setState({
          projectId, generation, status: "ready",
          drafts: drafts.filter((draft) => draft.rule_id === null || draft.has_unpublished_changes),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ projectId, generation, status: "error" });
      });
    return () => controller.abort();
  }, [projectId, generation]);

  const current = state.projectId === projectId && state.generation === generation ? state : null;
  const loading = !current || current.status === "loading";

  return <section aria-label="自分のルールの下書き" aria-busy={loading} data-rule-draft-list className="mt-4 space-y-3 rounded-lg border border-line p-3">
    <h3 className="text-[13px] font-semibold text-text">自分の下書き</h3>
    {loading ? <p role="status" className="text-[12px] text-secondary">下書きを読み込んでいます…</p>
      : current.status === "error" ? <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-[12px] text-danger">下書きを取得できませんでした。</p>
        <button type="button" onClick={() => setGeneration((value) => value + 1)} className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">再読み込み</button>
      </div>
      : current.status === "ready" && (current.drafts.length === 0
        ? <p className="text-[12px] leading-5 text-secondary">保存済みの下書きはありません。編集画面で保存すると、ここから再開できます。</p>
        : <ul className="divide-y divide-line border-y border-line">
          {current.drafts.map((draft) => {
            const name = draft.name.trim() || "名前のないルール";
            const href = draft.rule_id === null
              ? `/projects/${projectId}/rules/new?draft=${encodeURIComponent(draft.id)}`
              : `/projects/${projectId}/rules/${draft.rule_id}`;
            return <li key={draft.id} data-rule-draft-id={draft.id} className="flex min-w-0 items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="break-words text-[13px] font-medium text-text">{name}</p>
                <p className="mt-1 text-[11px] text-secondary"><span>{draft.rule_id === null ? "未公開" : "未公開の変更"}</span><span className="mx-1.5" aria-hidden="true">·</span><time dateTime={draft.updated_at}>{updatedAtLabel(draft.updated_at)}</time> 更新</p>
              </div>
              <Link href={href} prefetch={false} aria-label={`${name}の編集を再開`} className="shrink-0 rounded-md px-2 py-1.5 text-[12px] font-medium text-accent-text hover:bg-accent-soft hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">再開</Link>
            </li>;
          })}
        </ul>)}
  </section>;
}
