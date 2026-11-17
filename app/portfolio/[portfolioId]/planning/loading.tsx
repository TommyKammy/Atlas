export default function PlanningLoading() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-6" role="status">
      <p className="text-[13px] text-muted">投資計画を読み込み中…</p>
      <div className="mt-4 space-y-3" aria-hidden>
        <div className="h-7 w-56 animate-pulse rounded bg-surface-strong" />
        <div className="h-9 w-full max-w-xl animate-pulse rounded bg-surface-muted" />
        <div className="h-36 w-full animate-pulse rounded-lg bg-surface-muted" />
      </div>
    </div>
  );
}
