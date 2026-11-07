"use client";

/** Dependency list, removal and add controls in the task pane. */
export default function TaskDependenciesSection({
  taskId,
  dependencies,
  taskOptions,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  taskId: number;
  dependencies: { id: number; name: string }[];
  taskOptions: { id: number; name: string }[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="mt-2">
      <div className="flex min-h-9 items-start gap-2 rounded-md px-1 py-1 hover:bg-neutral-50">
        <span className="w-28 shrink-0 pt-1.5 text-sm text-neutral-500">依存関係</span>
        <div className="min-w-0 flex-1">
          {dependencies.length === 0 && (
            <div className="flex h-8 items-center text-sm text-neutral-500">依存関係を追加</div>
          )}
          {dependencies.map((d) => (
            <div key={d.id} className="flex h-8 items-center gap-2 border-b text-sm">
              <span className="flex-1 truncate">⛔ {d.name}</span>
              <button
                onClick={() => onRemove(d.id)}
                className="text-neutral-500 hover:text-red-600"
                title="依存を外す"
              >
                ×
              </button>
            </div>
          ))}
          <div className="mt-1 flex gap-2">
            <select
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              className="w-full rounded border px-2 py-1 text-sm"
            >
              <option value="">このタスクの前に…</option>
              {taskOptions
                .filter((o) => o.id !== taskId && !dependencies.some((d) => d.id === o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
            <button
              onClick={onAdd}
              className="shrink-0 rounded bg-neutral-200 px-3 py-1 text-sm hover:bg-neutral-300"
            >
              追加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
