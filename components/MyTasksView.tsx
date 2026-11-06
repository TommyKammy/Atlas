"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TaskRow } from "@/lib/data";
import { shiftDate } from "@/lib/timeline-dnd";

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
  const [order, setOrder] = useState<number[]>(tasks.map((task) => task.id));
  const [dueOverrides, setDueOverrides] = useState<Record<number, string | null>>({});
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [overBucket, setOverBucket] = useState<BucketKey | null>(null);
  const [saving, setSaving] = useState(false);

  const dueOf = (task: MyTask) =>
    dueOverrides[task.id] !== undefined ? dueOverrides[task.id] : task.due_on;

  const effective = tasks.map((task) => ({ ...task, due_on: dueOf(task) }));
  const grouped = BUCKETS.map((bucket) => ({
    ...bucket,
    items: effective
      .filter((task) => bucketOf(task.due_on, today) === bucket.key)
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
  }));

  const persist = async (
    nextOrder: number[],
    nextDue: Record<number, string | null>,
  ) => {
    setOrder(nextOrder);
    setDueOverrides(nextDue);
    setSaving(true);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const items = nextOrder.map((id, index) => ({
      task_id: id,
      position: (index + 1) * 1000,
      due_on: nextDue[id] !== undefined ? nextDue[id] : (byId.get(id)?.due_on ?? null),
    }));
    try {
      const res = await fetch("/api/my-tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        alert(`並び順の保存に失敗しました: ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const moveWithin = (id: number, direction: "up" | "down") => {
    const current = effective.find((task) => task.id === id);
    if (!current) return;
    const bucket = bucketOf(current.due_on, today);
    const ids = grouped.find((group) => group.key === bucket)?.items.map((task) => task.id) ?? [];
    const index = ids.indexOf(id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ids.length) return;
    const next = [...order];
    const a = next.indexOf(ids[index]);
    const b = next.indexOf(ids[swapIndex]);
    if (a < 0 || b < 0) return;
    [next[a], next[b]] = [next[b], next[a]];
    void persist(next, dueOverrides);
  };

  const dropOnRow = (
    e: React.DragEvent,
    targetId: number,
    targetBucket: BucketKey,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = Number(e.dataTransfer.getData("text/my-task")) || draggingId;
    setDraggingId(null);
    setOverBucket(null);
    if (!sourceId || sourceId === targetId) return;
    const source = effective.find((task) => task.id === sourceId);
    if (!source) return;
    const sourceBucket = bucketOf(source.due_on, today);
    const nextDue = { ...dueOverrides };
    if (sourceBucket !== targetBucket) {
      nextDue[sourceId] = dueForBucket(targetBucket, today);
    }
    const next = order.filter((id) => id !== sourceId);
    const insertAt = next.indexOf(targetId);
    next.splice(insertAt < 0 ? next.length : insertAt, 0, sourceId);
    void persist(next, nextDue);
  };

  const dropOnBucket = (e: React.DragEvent, targetBucket: BucketKey) => {
    e.preventDefault();
    const sourceId = Number(e.dataTransfer.getData("text/my-task")) || draggingId;
    setDraggingId(null);
    setOverBucket(null);
    if (!sourceId) return;
    const source = effective.find((task) => task.id === sourceId);
    if (!source) return;
    const sourceBucket = bucketOf(source.due_on, today);
    if (sourceBucket === targetBucket) return;
    const ids = grouped.find((group) => group.key === targetBucket)?.items.map((task) => task.id) ?? [];
    const nextDue = { ...dueOverrides, [sourceId]: dueForBucket(targetBucket, today) };
    const next = order.filter((id) => id !== sourceId);
    const last = ids[ids.length - 1];
    const insertAt = last === undefined ? next.length : next.indexOf(last) + 1;
    next.splice(insertAt < 0 ? next.length : insertAt, 0, sourceId);
    void persist(next, nextDue);
  };

  return (
    <div className="p-6" data-my-tasks-view data-my-task-saving={saving}>
      <h1 className="text-lg font-bold">マイタスク（{viewerName}）</h1>
      <p className="mt-1 text-sm text-neutral-500">
        未完了・担当が自分・全プロジェクト横断。ドラッグで並び替え、別のバケットへ移動すると期日が変わります。
      </p>
      {tasks.length === 0 && <p className="mt-4 text-neutral-600">割当タスクはありません。</p>}
      <div className="mt-4 max-w-4xl">
        {grouped.map((bucket) => (
          <div
            key={bucket.key}
            id={bucket.key}
            data-my-task-bucket={bucket.key}
            data-my-task-count={bucket.items.length}
            onDragOver={(e) => {
              e.preventDefault();
              setOverBucket(bucket.key);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverBucket(null);
            }}
            onDrop={(e) => dropOnBucket(e, bucket.key)}
            className={`mb-5 rounded-lg border border-transparent px-1 pb-1 ${
              overBucket === bucket.key ? "border-blue-300 bg-blue-50/40" : ""
            }`}
          >
            <h2
              className={`px-1 font-semibold ${
                bucket.alert && bucket.items.length > 0 ? "text-red-700" : ""
              }`}
            >
              {bucket.label}（{bucket.items.length}）
            </h2>
            {bucket.items.length === 0 && (
              <div
                data-my-task-empty={bucket.key}
                className="mx-1 mt-1 rounded border border-dashed border-neutral-200 px-3 py-2 text-[12px] text-neutral-400"
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
                draggable
                onDragStart={(e) => {
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
                  setOverBucket(bucket.key);
                }}
                onDrop={(e) => dropOnRow(e, task.id, bucket.key)}
                className={`group flex cursor-grab items-center gap-3 border-b border-neutral-200 py-2 text-sm hover:bg-neutral-50 ${
                  draggingId === task.id ? "opacity-50" : ""
                }`}
              >
                <span
                  data-my-task-drag-handle
                  className="w-3 shrink-0 text-center text-neutral-300 group-hover:text-neutral-500"
                  aria-hidden="true"
                >
                  ⠿
                </span>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-neutral-400" />
                <Link
                  href={`/projects/${task.project_id}?view=list&task=${task.id}`}
                  title={task.name}
                  dir="auto"
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {task.name}
                </Link>
                <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">
                  {task.project_name ?? "–"}
                </span>
                <span
                  className={`w-24 shrink-0 ${
                    bucket.alert ? "font-semibold text-red-600" : "text-neutral-600"
                  }`}
                >
                  {task.due_on ?? "–"}
                </span>
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    data-my-task-up={task.id}
                    aria-label="上へ移動"
                    disabled={index === 0}
                    onClick={() => moveWithin(task.id, "up")}
                    className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    data-my-task-down={task.id}
                    aria-label="下へ移動"
                    disabled={index === bucket.items.length - 1}
                    onClick={() => moveWithin(task.id, "down")}
                    className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
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
  );
}
