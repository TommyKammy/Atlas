"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import type { RuleRun } from "@/lib/automation/types";
import RuleEvaluationDetails from "./RuleEvaluationDetails";

export default function RuleExecutionHistory({ projectId, ruleId, descriptors }: { projectId: number; ruleId: number | null; descriptors: RuleDescriptors }) {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ loading: boolean; runs: RuleRun[]; error: string }>({ loading: true, runs: [], error: "" });
  useEffect(() => {
    if (!ruleId) return;
    const controller = new AbortController();
    void api<{ runs: RuleRun[] }>(`/api/projects/${projectId}/rules/${ruleId}/runs?limit=50`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setState({ loading: false, runs: result.runs, error: "" }); })
      .catch((caught) => { if (!controller.signal.aborted) setState({ loading: false, runs: [], error: caught instanceof Error ? caught.message : "実行履歴を取得できませんでした" }); });
    return () => controller.abort();
  }, [projectId, ruleId, generation]);
  if (!ruleId) return <p className="p-8 text-[13px] text-secondary">公開後に実行履歴を確認できます。</p>;
  return <section className="min-h-0 flex-1 overflow-auto p-6" aria-label="ルールの実行履歴">
    <div className="mb-5 flex items-center justify-between"><h2 className="text-[16px] font-semibold">実行履歴</h2><button type="button" onClick={() => { setState({ loading: true, runs: [], error: "" }); setGeneration((value) => value + 1); }} className="h-8 rounded-md border border-line px-3 text-[12px]">更新</button></div>
    {state.loading ? <p role="status" className="text-[13px] text-muted">実行履歴を読み込んでいます…</p> : state.error ? <p role="alert" className="text-[13px] text-danger">{state.error}</p> : state.runs.length === 0 ? <p className="text-[13px] text-muted">実行履歴はありません。</p> : <div className="max-w-4xl space-y-3">{state.runs.map((run) => <details key={run.id} className="rounded-lg border border-line bg-surface p-4">
      <summary className="cursor-pointer text-[12px]"><span className={`mr-3 rounded px-2 py-1 ${run.status === "success" ? "bg-success-soft text-success" : run.status === "failed" ? "bg-rose-50 text-rose-700" : "bg-surface-muted text-secondary"}`}>{run.status === "success" ? "成功" : run.status === "failed" ? "失敗" : "スキップ"}</span>{run.started_at}<span className="ml-3 text-muted">{run.actions_succeeded}/{run.actions_total} アクション成功 · v{run.rule_version}</span></summary>
      <div className="mt-4 space-y-4">{run.error && <p className="text-[12px] text-danger">{run.error}</p>}{run.evaluation ? <RuleEvaluationDetails trace={run.evaluation} descriptors={descriptors} /> : <p className="text-[12px] text-muted">この履歴には条件の評価記録がありません。</p>}
        <ol className="space-y-2">{run.details.map((detail) => <li key={detail.index} className="rounded-md bg-surface-subtle p-3 text-[12px]"><p>{detail.status === "success" ? "✓ 成功" : "× 失敗"} · {descriptors.actions.find((entry) => entry.id === detail.capability)?.label ?? detail.capability}</p>{detail.error && <p className="mt-1 text-danger">{detail.error}</p>}{detail.attempts && detail.attempts > 1 && <p className="mt-1 text-[11px] text-muted">{detail.attempts}回試行</p>}</li>)}</ol>
      </div>
    </details>)}</div>}
  </section>;
}
