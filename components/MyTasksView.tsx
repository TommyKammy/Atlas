"use client";

import EmptyState from "./EmptyState";
import InlineError from "./ui/InlineError";
import MutationFeedback from "./ui/MutationFeedback";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import type { TaskRow } from "@/lib/data";
import DueStateIcon from "./task/DueStateIcon";
import { shiftDate } from "@/lib/timeline-dnd";
import { ApiError, api } from "@/lib/api-client";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { applyMyTaskMove, MY_TASK_MOVE_TASK_LIMIT, parseMyTaskSnapshot, type MyTaskMove, type MyTaskSnapshot } from "@/lib/my-task-order";

type MyTask = TaskRow & { project_name: string | null };
type BucketKey = "overdue" | "today" | "week" | "later";

const BUCKETS: { key: BucketKey; label: string; alert?: boolean }[] = [
  { key: "overdue", label: "期限超過", alert: true },
  { key: "today", label: "今日が期日" },
  { key: "week", label: "今週" },
  { key: "later", label: "それ以降・未設定" },
];

function bucketOf(due: string | null, today: string): BucketKey {
  if (due !== null && due < today) return "overdue";
  if (due === today) return "today";
  if (due !== null && due <= shiftDate(today, 7)) return "week";
  return "later";
}

function dueForBucket(key: BucketKey, today: string): string | null {
  if (key === "overdue") return shiftDate(today, -1);
  if (key === "today") return today;
  if (key === "week") return shiftDate(today, 3);
  return null;
}

export default function MyTasksView({
  tasks,
  today,
  viewerName,
}: {
  tasks: MyTask[];
  today: string;
  viewerName: string;
}) {
  const router = useRouter();
  const [refreshPending, startRefresh] = useTransition();
  const propsKey = tasks.map((task) => `${task.id}:${task.updated_at}:${task.due_on ?? ""}`).join("|");
  const propsKeyRef = useRef({ key: propsKey, generation: 0 });
  useLayoutEffect(() => {
    if (propsKeyRef.current.key !== propsKey) {
      propsKeyRef.current = { key: propsKey, generation: propsKeyRef.current.generation + 1 };
    }
  }, [propsKey]);
  const [snapshot, setSnapshot] = useState<(MyTaskSnapshot & { propsKey: string }) | null>(null);
  const [optimistic, setOptimistic] = useState<{
    base: string;
    order: number[];
    due?: { task_id: number; due_on: string | null };
  } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [overBucket, setOverBucket] = useState<BucketKey | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [syncRequired, setSyncRequired] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);

  const current = snapshot?.propsKey === propsKey ? snapshot : {
    items: tasks.map((task) => ({ task_id: task.id, due_on: task.due_on, updated_at: task.updated_at })),
    overflow: tasks.length > MY_TASK_MOVE_TASK_LIMIT,
  };
  const currentKey = current.items.map((item) => `${item.task_id}:${item.updated_at}:${item.due_on ?? ""}`).join("|");
  const pending = optimistic?.base === currentKey ? optimistic : null;
  const order = pending?.order ?? current.items.map((item) => item.task_id);
  const rank = new Map(order.map((id, index) => [id, index]));
  const metadata = new Map(current.items.map((item) => [item.task_id, item]));
  const effective = tasks.flatMap((task) => {
    const latest = metadata.get(task.id);
    if (!latest) return [];
    return [{ ...task, updated_at: latest.updated_at,
      due_on: pending?.due?.task_id === task.id ? pending.due.due_on : latest.due_on }];
  });
  const tooMany = current.overflow || tasks.length > MY_TASK_MOVE_TASK_LIMIT;
  const busy = saving || refreshPending;
  const cannotMove = busy || syncRequired || tooMany;
  const grouped = BUCKETS.map((bucket) => ({
    ...bucket,
    items: effective
      .filter((task) => bucketOf(task.due_on, today) === bucket.key)
      .sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)),
  }));

  const synchronize = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = propsKeyRef.current;
      const latest = parseMyTaskSnapshot(await api("/api/my-tasks", { method: "GET" }));
      // An intervening RSC payload may belong to another ordering/date version.
      // Never attach an older GET to whichever props happen to be current.
      if (propsKeyRef.current !== generation) continue;
      // Date, order and exact optimistic version publish in one state update.
      setSnapshot({ ...latest, propsKey: generation.key });
      setOptimistic(null);
      setSyncRequired(false);
      startRefresh(() => router.refresh());
      return;
    }
    throw new Error("My Tasks changed while synchronizing");
  };

  const persist = async (move: MyTaskMove, due?: { task_id: number; due_on: string | null; expected_updated_at: string }) => {
    if (savingRef.current || cannotMove) return;
    savingRef.current = true;
    setSaving(true);
    setPersistError(null);
    let dateSaved = false;
    let failure: string | null = null;
    try {
      setOptimistic({ base: currentKey, order: applyMyTaskMove(order, move), due });
      if (due) {
        // Shared changes retain the normal permission, approval, event and
        // notification pipeline. Personal ordering never writes task dates.
        await patchTask(due.task_id, { due_on: due.due_on }, due.expected_updated_at);
        dateSaved = true;
      }
      await api("/api/my-tasks", "PUT", { move });
    } catch (error) {
      failure = dateSaved
        ? "期日は更新しましたが、並び順を保存できませんでした。"
        : error instanceof TaskConflictError || (error instanceof ApiError && error.status === 409)
          ? "タスクが他の場所で更新されました。もう一度移動してください。"
          : error instanceof ApiError && error.status === 403
            ? "このタスクの期日を変更する権限がありません。"
            : "変更を保存できませんでした。最新の状態を確認してからもう一度お試しください。";
      setOptimistic(null);
    }
    try {
      // Do not re-enable a second date edit using an old version after success,
      // conflict, partial success, or an ambiguous network failure.
      await synchronize();
    } catch {
      setOptimistic(null);
      setSyncRequired(true);
      failure = `${failure ?? (dateSaved ? "期日と並び順の保存後、" : "保存後、")}最新状態を取得できませんでした。表示は保存前の状態です。再取得するまで移動できません。`;
    } finally {
      setPersistError(failure);
      savingRef.current = false;
      setSaving(false);
    }
  };

  const retrySynchronization = async () => {
    if (savingRef.current || busy) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await synchronize();
      setPersistError(null);
    } catch {
      setPersistError("最新状態を取得できませんでした。もう一度再取得してください。");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const moveWithin = (id: number, direction: "up" | "down") => {
    if (cannotMove || savingRef.current) return;
    const current = effective.find((task) => task.id === id);
    if (!current) return;
    const bucket = bucketOf(current.due_on, today);
    const ids = grouped.find((group) => group.key === bucket)?.items.map((task) => task.id) ?? [];
    const index = ids.indexOf(id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ids.length) return;
    void persist({ task_id: id, ...(direction === "up"
      ? { before_task_id: ids[swapIndex] } : { after_task_id: ids[swapIndex] }) });
  };

  const dropOnRow = (
    e: React.DragEvent,
    targetId: number,
    targetBucket: BucketKey,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (cannotMove || savingRef.current) return;
    const sourceId = Number(e.dataTransfer.getData("text/my-task")) || draggingId;
    setDraggingId(null);
    setOverBucket(null);
    if (!sourceId || sourceId === targetId) return;
    const source = effective.find((task) => task.id === sourceId);
    if (!source) return;
    const sourceBucket = bucketOf(source.due_on, today);
    void persist({ task_id: sourceId, before_task_id: targetId }, sourceBucket === targetBucket ? undefined : {
      task_id: sourceId, due_on: dueForBucket(targetBucket, today), expected_updated_at: source.updated_at,
    });
  };

  const dropOnBucket = (e: React.DragEvent, targetBucket: BucketKey) => {
    e.preventDefault();
    if (cannotMove || savingRef.current) return;
    const sourceId = Number(e.dataTransfer.getData("text/my-task")) || draggingId;
    setDraggingId(null);
    setOverBucket(null);
    if (!sourceId) return;
    const source = effective.find((task) => task.id === sourceId);
    if (!source) return;
    const sourceBucket = bucketOf(source.due_on, today);
    if (sourceBucket === targetBucket) return;
    const ids = grouped.find((group) => group.key === targetBucket)?.items.map((task) => task.id) ?? [];
    const last = ids[ids.length - 1];
    void persist({ task_id: sourceId, ...(last === undefined ? {} : { after_task_id: last }) }, {
      task_id: sourceId, due_on: dueForBucket(targetBucket, today), expected_updated_at: source.updated_at,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-my-tasks-view data-my-task-saving={busy} data-my-task-sync-required={syncRequired}>
      <div data-page-fixed className="shrink-0 p-6 pb-0">
      <h1 className="text-lg font-bold">マイタスク（{viewerName}）</h1>
      <InlineError message={persistError} onDismiss={syncRequired ? undefined : () => setPersistError(null)} className="mt-2 max-w-4xl" />
      {syncRequired && <button type="button" onClick={() => void retrySynchronization()} disabled={busy} data-my-task-resync
        className="mt-2 rounded border border-line-strong px-3 py-1 text-[12px] text-secondary hover:bg-hover disabled:opacity-50">最新状態を再取得</button>}
      <MutationFeedback pending={busy} pendingLabel={refreshPending && !saving ? "最新状態を表示しています…" : "保存中…"} className="mt-1" />
      {tooMany && <p role="status" data-my-task-order-limit className="mt-2 text-[12px] text-secondary">
        並び替え・バケット移動は{MY_TASK_MOVE_TASK_LIMIT.toLocaleString("ja-JP")}件まで対応しています。現在は表示とタスク詳細の操作を利用できます。
      </p>}
      <p className="mt-1 text-sm text-muted">
        未完了・担当が自分・全プロジェクト横断。ドラッグで並び替え、別のバケットへ移動すると期日が変わります。
      </p>
      </div>
      <div data-page-scroll className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      {tasks.length === 0 && (
        <EmptyState
          scope="my-tasks"
          title="割当タスクはありません"
          description="担当者に割り当てられた未完了タスクがここに表示されます。"
        />
      )}
      <div className="mt-4 max-w-4xl">
        {grouped.map((bucket) => (
          <div
            key={bucket.key}
            id={bucket.key}
            data-my-task-bucket={bucket.key}
            data-my-task-count={bucket.items.length}
            onDragOver={(e) => {
              e.preventDefault();
              if (cannotMove) return;
              setOverBucket(bucket.key);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverBucket(null);
            }}
            onDrop={(e) => dropOnBucket(e, bucket.key)}
            className={`mb-5 rounded-lg border px-1 pb-1 ${
              overBucket === bucket.key ? "border-accent-line bg-accent-soft/40" : "border-transparent"
            }`}
          >
            <h2
              className={`px-1 font-semibold ${
                bucket.alert && bucket.items.length > 0 ? "text-danger" : ""
              }`}
            >
              {bucket.label}（{bucket.items.length}）
            </h2>
            {bucket.items.length === 0 && (
              <div
                data-my-task-empty={bucket.key}
                className="mx-1 mt-1 rounded border border-dashed border-line px-3 py-2 text-[12px] text-muted"
              >
                ここにタスクをドラッグ
              </div>
            )}
            {bucket.items.map((task, index) => (
              <div
                key={task.id}
                data-my-task-row={task.id}
                data-my-task-bucket-key={bucket.key}
                data-my-task-position={index}
                data-my-task-due={task.due_on ?? ""}
                draggable={!cannotMove}
                onDragStart={(e) => {
                  if (cannotMove || savingRef.current) { e.preventDefault(); return; }
                  setDraggingId(task.id);
                  e.dataTransfer.setData("text/my-task", String(task.id));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setOverBucket(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (cannotMove) return;
                  setOverBucket(bucket.key);
                }}
                onDrop={(e) => dropOnRow(e, task.id, bucket.key)}
                className={`group flex cursor-grab items-center gap-3 border-b border-line py-2 text-sm hover:bg-hover ${
                  draggingId === task.id ? "opacity-50" : ""
                }`}
              >
                <span
                  data-my-task-drag-handle
                  className="w-3 shrink-0 text-center text-subtle group-hover:text-muted"
                  aria-hidden="true"
                >
                  ⠿
                </span>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong" />
                <Link
                  href={`/projects/${task.project_id}?view=list&task=${task.id}`}
                  title={task.name}
                  dir="auto"
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {task.name}
                </Link>
                <span className="hidden shrink-0 text-xs text-muted sm:inline">
                  {task.project_name ?? "–"}
                </span>
                <span
                  className={`w-24 shrink-0 ${
                    bucket.alert ? "font-semibold text-danger" : "text-secondary"
                  }`}
                  title={
                    bucket.alert && task.due_on
                      ? `期限超過: ${task.due_on}`
                      : bucket.key === "today" && task.due_on
                        ? `今日が期日: ${task.due_on}`
                        : undefined
                  }
                >
                  {bucket.alert && <DueStateIcon state="overdue" className="mr-1 align-[-2px]" />}
                  {bucket.key === "today" && <DueStateIcon state="today" className="mr-1 align-[-2px]" />}
                  {bucket.alert && <span className="sr-only">期限超過: </span>}
                  {bucket.key === "today" && <span className="sr-only">今日が期日: </span>}
                  {task.due_on ?? "–"}
                </span>
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    data-my-task-up={task.id}
                    aria-label="上へ移動"
                    disabled={cannotMove || index === 0}
                    onClick={() => moveWithin(task.id, "up")}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-hover-strong disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    data-my-task-down={task.id}
                    aria-label="下へ移動"
                    disabled={cannotMove || index === bucket.items.length - 1}
                    onClick={() => moveWithin(task.id, "down")}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-hover-strong disabled:opacity-30"
                  >
                    ↓
                  </button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
