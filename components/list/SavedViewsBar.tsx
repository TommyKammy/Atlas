"use client";

import type { SavedView } from "@/lib/data";

/** Saved-view pills shown directly under the list toolbar. */
export default function SavedViewsBar({
  projectId,
  savedViews,
  activeSavedId,
  onDelete,
}: {
  projectId: number;
  savedViews: SavedView[];
  activeSavedId: number | null;
  onDelete: (id: number) => Promise<void>;
}) {
  if (savedViews.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b py-1.5 text-sm">
      {savedViews.map((view) => (
        <span
          key={view.id}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${
            view.id === activeSavedId
              ? "border-blue-600 bg-accent-soft text-accent-text"
              : "text-secondary"
          }`}
        >
          <a href={`/projects/${projectId}?view=list&saved=${view.id}`}>{view.name}</a>
          <button
            onClick={() => void onDelete(view.id)}
            title="保存ビューを削除"
            className="text-neutral-300 hover:text-red-600"
          >
            ×
          </button>
        </span>
      ))}
      {activeSavedId !== null && (
        <a href={`/projects/${projectId}?view=list`} className="text-muted hover:text-black">
          クリア ×
        </a>
      )}
    </div>
  );
}
