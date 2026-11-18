"use client";

import Link from "next/link";
import { useState } from "react";

/** Dependency chips and an on-demand picker inside the task pane. */
export default function TaskDependenciesSection({
  projectId,
  view,
  taskId,
  dependencies,
  taskOptions,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  projectId: number;
  view: string;
  taskId: number;
  dependencies: { id: number; name: string }[];
  taskOptions: { id: number; name: string }[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex min-h-9 items-start gap-2 rounded-md px-1 py-1 hover:bg-hover">
      <span className="w-[88px] shrink-0 pt-1.5 text-[12px] text-muted">依存関係</span>
      <div className="min-w-0 flex-1">
        {dependencies.length === 0 && !adding && (
          <span className="flex h-7 items-center text-[13px] text-subtle">依存関係なし</span>
        )}
        {dependencies.map((dependency) => (
          <div key={dependency.id} className="flex min-h-7 items-center gap-1.5 text-[13px]">
            <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
              先行
            </span>
            <Link
              href={`/projects/${projectId}?view=${view}&task=${dependency.id}`}
              className="min-w-0 flex-1 truncate text-text hover:text-accent-text hover:underline"
              title={dependency.name}
            >
              {dependency.name}
            </Link>
            <button
              type="button"
              onClick={() => onRemove(dependency.id)}
              className="shrink-0 rounded px-1 text-[12px] text-neutral-400 hover:bg-hover hover:text-red-600"
              title="依存を外す"
              aria-label={`${dependency.name} の依存を外す`}
            >
              ×
            </button>
          </div>
        ))}

        {adding ? (
          <div className="mt-1 flex flex-col gap-1">
            <div className="flex gap-1.5">
              <select
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded border border-line-strong px-2 text-[12px] outline-none focus:border-accent"
                aria-label="依存関係を追加"
              >
                <option value="">このタスクの前に…</option>
                {taskOptions
                  .filter((option) => option.id !== taskId && !dependencies.some((d) => d.id === option.id))
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!draft}
                onClick={() => {
                  onAdd();
                  setAdding(false);
                }}
                className="shrink-0 rounded bg-accent px-3 text-[12px] font-medium text-on-accent hover:bg-accent-hover disabled:bg-neutral-200 disabled:text-neutral-500"
              >
                追加
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="self-start rounded px-1 py-0.5 text-[11px] text-muted hover:bg-hover"
            >
              キャンセル
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-7 items-center gap-1 rounded px-1 text-[12px] text-muted hover:bg-hover hover:text-secondary"
          >
            <span className="text-sm leading-none">＋</span>
            依存関係を追加
          </button>
        )}
      </div>
    </div>
  );
}
