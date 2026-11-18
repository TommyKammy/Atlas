"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import { editorPayload, type RuleEditorDocument } from "@/lib/automation/editor-model";
import type { RulePreviewResponse } from "@/lib/automation/evaluation";
import { hasTaskSubject } from "@/lib/automation/task-target";
import type { DomainEventType } from "@/lib/domain/events";
import Dialog from "../ui/Dialog";
import RuleEntityPicker from "./RuleEntityPicker";
import RuleEvaluationDetails from "./RuleEvaluationDetails";

export default function RulePreviewDialog({ projectId, ruleId, document, descriptors, onClose }: {
  projectId: number; ruleId: number | null; document: RuleEditorDocument; descriptors: RuleDescriptors; onClose: () => void;
}) {
  const [eventType, setEventType] = useState<DomainEventType>(document.triggers[0]?.event ?? "task.created");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [eventData, setEventData] = useState("");
  const [result, setResult] = useState<RulePreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const invalidate = () => { request.current?.abort(); setResult(null); setBusy(false); setError(""); };
  const run = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    let data: unknown = {};
    try {
      if (eventData.trim()) data = JSON.parse(eventData);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    } catch { setError("テスト用データはJSONオブジェクトで入力してください"); return; }
    setBusy(true); setError(""); setResult(null);
    try {
      const preview = await api<RulePreviewResponse>(`/api/projects/${projectId}/rules/preview`, {
        method: "POST", signal: controller.signal, body: {
          ...(ruleId ? { rule_id: ruleId } : {}), definition: editorPayload(document).definition,
          event: { type: eventType, ...(hasTaskSubject(eventType) ? { task_id: taskId } : {}), data },
        },
      });
      if (!controller.signal.aborted) setResult(preview);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "テストできませんでした"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <Dialog open onClose={onClose} title="ルールをテスト" panelClassName="flex max-h-[90vh] w-[min(720px,96vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface">
    <div className="flex shrink-0 items-center justify-between border-b border-line p-5"><h2 className="text-[17px] font-semibold">ルールをテスト</h2><button type="button" aria-label="閉じる" onClick={onClose} className="h-7 w-7 rounded text-lg text-muted hover:bg-hover">×</button></div>
    <div className="min-h-0 space-y-5 overflow-auto p-5">
      <p className="text-[12px] leading-6 text-secondary">現在の下書きの条件と分岐を確認します。タスクの更新やWebhook送信は行いません。</p>
      <label className="block text-[12px] font-medium">想定するきっかけ<select className="mt-2 h-9 w-full rounded-md border border-line px-2 text-[13px]" value={eventType} onChange={(event) => { invalidate(); setEventType(event.target.value as DomainEventType); }}>{descriptors.triggers.map((trigger) => <option key={trigger.id} value={trigger.id}>{trigger.label}</option>)}</select></label>
      {hasTaskSubject(eventType) && <RuleEntityPicker projectId={projectId} kind="task" value={taskId} label="テスト対象タスク" onChange={(id) => { invalidate(); setTaskId(id); }} required />}
      <details className="rounded-md border border-line p-3 text-[12px] text-secondary"><summary className="cursor-pointer">変更前の値・Webhookなどのテストデータ（任意）</summary><p className="mt-2 text-[11px] leading-5">イベントの値を指定する場合はJSONで入力します。タスクの現在値は選択したタスクから読み込みます。</p><textarea aria-label="テスト用イベントデータ" value={eventData} onChange={(event) => { invalidate(); setEventData(event.target.value); }} placeholder={'{"previous_status":"未着手","status":"進行中"}'} className="mt-2 h-24 w-full rounded-md border border-line p-2 font-mono text-[12px]" /></details>
      <button type="button" onClick={() => void run()} disabled={busy || (hasTaskSubject(eventType) && !taskId)} className="h-9 rounded-md bg-accent px-4 text-[12px] font-medium text-on-accent disabled:opacity-40">{busy ? "評価中…" : "変更せずにテスト"}</button>
      {error && <p role="alert" className="text-[12px] text-rose-600">{error}</p>}
      {result && <div className="space-y-5 border-t border-line pt-5" data-rule-preview-result>
        <RuleEvaluationDetails trace={result.trace} descriptors={descriptors} />
        {result.actions.length > 0 && <div><h3 className="text-[13px] font-semibold">実行予定のアクション</h3><ol className="mt-2 space-y-2">{result.actions.map((action, index) => <li key={index} className="rounded-md border border-line p-3 text-[12px]"><p className="font-medium">{index + 1}. {descriptors.actions.find((entry) => entry.id === action.capability)?.label ?? action.capability}</p><p className="mt-1 text-muted">{action.reason}</p>{Object.entries(action.params).map(([key, value]) => <p key={key} className="mt-1 break-words text-[11px] text-secondary">{descriptors.actions.find((entry) => entry.id === action.capability)?.params.find((param) => param.name === key)?.label ?? key}: {typeof value === "object" ? JSON.stringify(value) : String(value ?? "空")}</p>)}</li>)}</ol></div>}
        {result.warnings.length > 0 && <ul className="space-y-1 rounded-md bg-surface-subtle p-3 text-[11px] leading-5 text-secondary">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      </div>}
    </div>
  </Dialog>;
}
