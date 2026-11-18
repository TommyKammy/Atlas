"use client";

import type { TaskSaveState } from "@/lib/task-save-state";

export default function TaskSaveStatus({ states, reloading, onReload }: {
  states: Record<string, TaskSaveState>;
  reloading: boolean;
  onReload: () => void;
}) {
  const values = Object.values(states);
  const failures = values.filter((state) => state.phase === "failed");
  const saving = values.some((state) => state.phase === "saving");
  const conflicted = values.some((state) => state.phase === "conflict");
  if (reloading) return <p role="status" data-task-save-status="loading" className="mb-2 text-[12px] text-secondary">最新の状態を読み込んでいます…</p>;
  if (failures.length > 0) return (
    <section role="alert" data-task-save-status="failed" className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-900">
      {failures.map((state) => (
        <div key={state.key} className="mb-2 last:mb-0" data-task-save-field={state.key}>
          <p><span className="font-medium">{state.label}は未保存です。</span> {state.message}</p>
          {state.retry && <button type="button" data-task-save-control onClick={() => void state.retry?.()} className="mt-1 rounded border border-rose-300 bg-surface px-2 py-1 hover:bg-surface-subtle">{state.label}を再試行</button>}
        </div>
      ))}
      <button type="button" data-task-save-control data-task-conflict-discard onClick={onReload} disabled={saving} className="mt-2 rounded border border-line-strong bg-surface px-2 py-1 text-text hover:bg-hover disabled:opacity-50">入力を破棄して最新表示</button>
      {saving && <p className="mt-2">ほかの変更を保存しています…</p>}
    </section>
  );
  if (saving) return <p role="status" data-task-save-status="saving" className="mb-2 text-[12px] text-secondary">保存しています…</p>;
  if (values.length > 0 && !conflicted) return <p role="status" data-task-save-status="saved" className="mb-2 text-[12px] text-secondary">保存しました</p>;
  return null;
}
