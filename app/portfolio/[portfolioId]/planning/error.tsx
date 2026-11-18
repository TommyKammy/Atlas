"use client";

import Link from "next/link";

export default function PlanningError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-[820px] px-4 py-10 md:px-6">
      <div className="rounded-lg border border-danger-line bg-danger-soft p-6">
        <h1 className="text-[20px] font-semibold text-danger">投資計画を読み込めませんでした</h1>
        <p className="mt-2 text-[13px] leading-6 text-danger">
          一時的なエラーが発生しました。もう一度読み込むか、ポートフォリオに戻ってから開き直してください。
        </p>
        {error.digest && <p className="mt-2 text-[11px] text-danger">エラーID: {error.digest}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:bg-accent-hover"
          >
            再読み込み
          </button>
          <Link
            href="/portfolio"
            className="inline-flex min-h-9 items-center rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-secondary hover:bg-hover"
          >
            ポートフォリオに戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
