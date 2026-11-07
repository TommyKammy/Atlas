"use client";

/** Project-member visibility banner shown at the top of the task pane. */
export default function TaskVisibilityBanner({ onShare }: { onShare: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 bg-[#f8f8f8] px-4 py-2 text-[12px] text-neutral-600">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="3" y="7" width="10" height="7" rx="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      </svg>
      <span className="min-w-0 flex-1 truncate">
        このタスクはこのプロジェクトのメンバーのみに公開されています。
      </span>
      <button
        type="button"
        onClick={onShare}
        className="shrink-0 rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
      >
        共有
      </button>
    </div>
  );
}
