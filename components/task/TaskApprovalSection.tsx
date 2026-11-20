"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { TaskRow } from "@/lib/data";
import type { TaskApprovalAction, TaskApprovalResponse, TaskApprovalSummary } from "@/lib/task-approval";
import { TASK_APPROVAL_ACTION_LABELS, TASK_APPROVAL_STATUS_LABELS } from "@/lib/task-approval";
import TaskApprovalBadge from "./TaskApprovalBadge";

const inputClass = "w-full rounded border border-field-line bg-field px-2.5 py-2 text-[13px] text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:border-line disabled:bg-surface-subtle disabled:text-muted";
const secondaryButtonBase = "rounded border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = `${secondaryButtonBase} text-secondary`;
const dangerSecondaryButton = `${secondaryButtonBase} text-danger`;

export default function TaskApprovalSection({ task, viewerId, canEdit, openSignal, onSummaryChange, onChanged }: {
  task: TaskRow;
  viewerId: number;
  canEdit: boolean;
  openSignal: number;
  onSummaryChange: (approval: TaskApprovalSummary | null) => void;
  onChanged: () => void;
}) {
  const searchParams = useSearchParams();
  const approvalRequested = searchParams.get("approval") === "1";
  const [data, setData] = useState<TaskApprovalResponse | null>(null);
  const [expanded, setExpanded] = useState(Boolean(task.approval));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [approverId, setApproverId] = useState("");
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState("");
  const sectionRef = useRef<HTMLElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const explicitRead = useRef<AbortController | null>(null);
  const queuedBackgroundRead = useRef(false);
  const mutation = useRef(false);
  const alive = useRef(true);
  const taskStamp = useRef(task.updated_at);
  const summaryCallback = useRef(onSummaryChange);
  const changedCallback = useRef(onChanged);

  useEffect(() => { summaryCallback.current = onSummaryChange; changedCallback.current = onChanged; }, [onSummaryChange, onChanged]);

  const adopt = useCallback((result: TaskApprovalResponse) => {
    setData(result);
    summaryCallback.current(result.approval);
    const previous = result.approval?.approver_id;
    const requester = result.approval?.requester_id;
    setApproverId(previous != null && previous !== viewerId && previous !== requester &&
      result.eligible_approvers.some((person) => person.id === previous) ? String(previous) : "");
    if (result.approval) setExpanded(true);
  }, [viewerId]);

  const load = useCallback(async function loadApproval(explicit = false): Promise<void> {
    if (mutation.current) return;
    if (!explicit && explicitRead.current && !explicitRead.current.signal.aborted) {
      // A live update must not cancel the user's explicit confirmation read.
      // Re-read afterwards in case the live update is newer than its snapshot.
      queuedBackgroundRead.current = true;
      return;
    }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    if (explicit) {
      explicitRead.current = request;
      queuedBackgroundRead.current = false;
      // Only this explicit read's success may lift the confirmation fence.
      setStale(true);
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${task.id}/approval`, { signal: request.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "承認情報を読み込めませんでした");
      if (request.signal.aborted || !alive.current || controller.current !== request) return;
      adopt(result as TaskApprovalResponse);
      setReadFailed(false);
      if (explicit) {
        setStale(false);
        setNotice("最新の承認情報を読み込みました。内容を確認してから操作してください。");
      }
    } catch (caught) {
      if (!request.signal.aborted && alive.current && controller.current === request) {
        setReadFailed(true);
        setError(caught instanceof Error ? caught.message : "承認情報を読み込めませんでした");
      }
    } finally {
      if (explicitRead.current === request) explicitRead.current = null;
      if (!request.signal.aborted && alive.current && controller.current === request) {
        setLoading(false);
        if (explicit && queuedBackgroundRead.current) {
          queuedBackgroundRead.current = false;
          queueMicrotask(() => {
            if (alive.current && !mutation.current && controller.current === request) void loadApproval();
          });
        }
      }
    }
  }, [task.id, adopt]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; alive.current = false; controller.current?.abort(); };
  }, [load]);

  useEffect(() => {
    if (taskStamp.current === task.updated_at) return;
    taskStamp.current = task.updated_at;
    // A live refresh can arrive before our POST response. Do not abort that
    // request or discard its confirmed result; it supplies the latest stamp.
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled && !mutation.current) void load(); });
    return () => { cancelled = true; };
  }, [task.updated_at, load]);

  useEffect(() => {
    if (!openSignal && !approvalRequested) return;
    const frame = requestAnimationFrame(() => {
      setExpanded(true);
      sectionRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" });
      sectionRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [openSignal, approvalRequested]);

  const submit = async (action: TaskApprovalAction) => {
    if (!data || busy || loading || stale || readFailed || mutation.current) return;
    const needsApprover = action === "request" || action === "resubmit" || action === "reassign";
    const eligibleApprover = data.eligible_approvers.some((person) => String(person.id) === approverId &&
      person.id !== viewerId && person.id !== data.approval?.requester_id);
    if (needsApprover && !eligibleApprover) {
      setApproverId("");
      setError("承認者を選択してください。");
      selectRef.current?.focus();
      return;
    }
    if ((action === "reject" || action === "request_changes") && !comment.trim()) {
      setError("却下・差し戻しには理由を入力してください。");
      commentRef.current?.focus();
      return;
    }
    mutation.current = true;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setNotice("");
    let confirmedFailure = false;
    try {
      const response = await fetch(`/api/tasks/${task.id}/approval`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify({ action, expected_version: data.approval?.version ?? 0,
          expected_updated_at: data.task_updated_at,
          ...(needsApprover ? { approver_id: Number(approverId) } : {}), comment: comment.trim() }),
      });
      const result = await response.json();
      if (request.signal.aborted || !alive.current) return;
      if (!response.ok) {
        // A parsed 4xx is an explicit rejection. A lost/invalid response or
        // server error may follow a committed operation, so require a fresh read.
        confirmedFailure = response.status >= 400 && response.status < 500;
        if (response.status === 409) {
          setStale(true);
          throw new Error("他のユーザーが先に更新しました。入力した理由を保持しています。最新の承認情報を読み込んでから、もう一度判断してください。");
        }
        if (response.status === 401 || response.status === 403 || response.status === 404) setReadFailed(true);
        throw new Error(result.error || "承認の操作を保存できませんでした");
      }
      adopt(result as TaskApprovalResponse);
      setComment("");
      setQuery("");
      setNotice(TASK_APPROVAL_ACTION_LABELS[action]);
      changedCallback.current();
    } catch (caught) {
      if (!request.signal.aborted && alive.current) {
        if (!confirmedFailure) {
          setStale(true);
          setReadFailed(true);
          setError("操作の結果を確認できませんでした。入力した理由を保持しています。最新の承認情報を読み込み、反映済みか確認してから操作してください。");
        } else {
          setError(caught instanceof Error ? caught.message : "承認の操作を保存できませんでした");
        }
      }
    } finally {
      mutation.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const approval = data?.approval;
  const candidates = (data?.eligible_approvers ?? []).filter((person) => person.id !== viewerId && person.id !== approval?.requester_id);
  const visibleCandidates = candidates.filter((person) => person.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = candidates.find((person) => String(person.id) === approverId);
  const disabled = busy || loading || stale || readFailed;
  const displayError = error || (stale || readFailed ? "操作前に最新の承認情報を読み込んでください。入力した理由は保持しています。" : "");
  const canConfigure = Boolean(data && (approval ? data.can_manage : data.can_request));
  if (data && !approval && !data.can_request && !canEdit) return null;

  return <section ref={sectionRef} tabIndex={-1} data-task-approval aria-label="承認" aria-busy={busy || loading}
    className="mt-5 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" aria-expanded={expanded} aria-controls={`task-approval-${task.id}`} onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-2 rounded px-1 py-1 text-[13px] font-semibold text-text hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus-ring">
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>{approval ? "承認タスク" : "承認を設定"}
      </button>
      {approval && <TaskApprovalBadge approval={approval} />}
    </div>
    {(displayError || notice) && <div className="mt-2" aria-live="polite">
      {displayError && <p role="alert" className="text-[12px] leading-5 text-danger">{displayError}</p>}
      {notice && <p role="status" className="text-[12px] leading-5 text-secondary">{notice}</p>}
      {displayError && <button type="button" disabled={busy || loading} onClick={() => void load(true)} className={`${secondaryButton} mt-2`}>最新の承認情報を読み込む</button>}
    </div>}
    <div id={`task-approval-${task.id}`} hidden={!expanded} className="mt-3 space-y-3">
      {loading && <p role="status" className="text-[12px] text-secondary">承認情報を読み込んでいます…</p>}
      {approval && <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px] leading-5">
        <dt className="text-secondary">状態</dt><dd>{TASK_APPROVAL_STATUS_LABELS[approval.status]} · 第{approval.round}回</dd>
        <dt className="text-secondary">承認者</dt><dd className="break-words">{approval.approver_name ?? "未設定（再指定が必要です）"}</dd>
        <dt className="text-secondary">申請者</dt><dd className="break-words">{approval.requester_name ?? "削除されたユーザー"}</dd>
      </dl>}
      {approval?.status === "approved" && <p className="text-[12px] leading-5 text-secondary">内容を変更して再確認が必要な場合は、再申請してください。</p>}
      {!approval && data && !data.can_request && <p className="text-[12px] leading-5 text-secondary">承認の申請には、主プロジェクトの編集権限が必要です。マイルストーンと繰り返しタスクは承認タスクにできません。</p>}
      {canConfigure && <div className="space-y-2">
        <label className="block text-[12px] font-medium text-secondary">承認者を検索
          <input type="search" aria-label="承認者を検索" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} placeholder="名前で検索" className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-[12px] font-medium text-secondary">承認者
          <select ref={selectRef} aria-label="承認者" value={approverId} disabled={disabled || candidates.length === 0} onChange={(event) => setApproverId(event.target.value)} className={`${inputClass} mt-1`}>
            <option value="">承認者を選択</option>
            {selected && !visibleCandidates.some((person) => person.id === selected.id) && <option value={selected.id}>{selected.name}</option>}
            {visibleCandidates.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        {candidates.length === 0 ? <p className="text-[12px] text-secondary">選択できる承認者がいません。主プロジェクトに編集権限のある別のメンバーが必要です。</p>
          : visibleCandidates.length === 0 && query && <p className="text-[12px] text-secondary">検索に一致する承認者がいません。</p>}
      </div>}
      {data && (canConfigure || data.can_decide) && <div className="space-y-2">
        <label className="block text-[12px] font-medium text-secondary">コメント・理由
          <textarea ref={commentRef} aria-label="承認のコメント・理由" value={comment} maxLength={2000} rows={3} disabled={disabled} onChange={(event) => setComment(event.target.value)} placeholder="申請の説明、判断の理由など" className={`${inputClass} mt-1 resize-y`} />
        </label>
        {data.can_decide && <p className="text-[11px] text-secondary">却下・差し戻しには理由が必要です。</p>}
        <div className="flex flex-wrap gap-2">
          {!approval && data.can_request && <button type="button" disabled={disabled || !selected} onClick={() => void submit("request")} className="rounded bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50">承認を申請</button>}
          {approval?.status === "pending" && data.can_decide && <>
            <button type="button" disabled={disabled} onClick={() => void submit("approve")} className="rounded bg-success-strong px-3 py-1.5 text-[12px] font-medium text-on-strong hover:bg-success-strong-hover disabled:opacity-50">承認する</button>
            <button type="button" disabled={disabled} onClick={() => void submit("request_changes")} className={secondaryButton}>差し戻す</button>
            <button type="button" disabled={disabled} onClick={() => void submit("reject")} className={dangerSecondaryButton}>却下する</button>
          </>}
          {approval?.status === "pending" && data.can_manage && <button type="button" disabled={disabled || !selected || selected.id === approval.approver_id} onClick={() => void submit("reassign")} className={secondaryButton}>承認者を変更</button>}
          {approval && approval.status !== "pending" && data.can_manage && <button type="button" disabled={disabled || !selected} onClick={() => void submit("resubmit")} className="rounded bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50">再申請する</button>}
        </div>
      </div>}
      {approval?.status === "pending" && data && !data.can_decide && <p className="text-[12px] text-secondary">判断できるのは指定された承認者だけです。</p>}
      {data && data.history.length > 0 && <details className="border-t border-line-subtle pt-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-secondary">承認履歴（{data.history.length}件）</summary>
        <ol data-approval-history className="mt-2 space-y-3">
          {data.history.map((entry) => <li key={entry.id} data-approval-history-action={entry.action} className="border-l-2 border-line pl-3 text-[12px] leading-5 text-secondary">
            <p><span className="font-medium">{entry.actor_name}</span>が{TASK_APPROVAL_ACTION_LABELS[entry.action]} <span className="text-secondary">· 第{entry.round}回</span></p>
            <p className="text-[11px] text-secondary">承認者: {entry.approver_name} · {new Date(entry.created_at).toLocaleString("ja-JP")}</p>
            {entry.comment && <p className="mt-1 whitespace-pre-wrap break-words">{entry.comment}</p>}
          </li>)}
        </ol>
      </details>}
    </div>
  </section>;
}
