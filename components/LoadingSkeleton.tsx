export default function LoadingSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div data-loading-skeleton className="animate-pulse px-4 py-4" aria-label="読み込み中" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-neutral-200" />
        <div className="h-5 w-52 rounded bg-neutral-200" />
        <div className="ml-auto h-7 w-24 rounded-md bg-neutral-100" />
      </div>
      <div className="mt-4 flex gap-2">
        {[64, 88, 56, 64, 72, 72].map((width, index) => (
          <div key={index} className="h-6 rounded bg-neutral-100" style={{ width }} />
        ))}
      </div>
      <div className="mt-5 flex items-center gap-2">
        <div className="h-7 w-28 rounded-md bg-neutral-200" />
        <div className="ml-auto h-7 w-20 rounded-md bg-neutral-100" />
        <div className="h-7 w-16 rounded-md bg-neutral-100" />
      </div>
      <div className="mt-4 overflow-hidden rounded-md border border-neutral-100">
        <div className="h-9 border-b border-neutral-100 bg-neutral-50" />
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex h-[37px] items-center gap-4 border-b border-neutral-100 px-3 last:border-0">
            <div className="h-3.5 w-3.5 rounded-full bg-neutral-200" />
            <div className="h-3.5 rounded bg-neutral-200" style={{ width: `${160 + ((index * 47) % 220)}px` }} />
            <div className="ml-auto h-3 w-16 rounded bg-neutral-100" />
            <div className="h-3 w-20 rounded bg-neutral-100" />
            <div className="h-3 w-10 rounded bg-neutral-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
