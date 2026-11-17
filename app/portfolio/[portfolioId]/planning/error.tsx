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
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h1 className="text-[20px] font-semibold text-red-900">投資計画を読み込めませんでした</h1>
        <p className="mt-2 text-[13px] leading-6 text-red-900">
          一時的なエラーが発生しました。もう一度読み込むか、ポートフォリオに戻ってから開き直してください。
        </p>
        {error.digest && <p className="mt-2 text-[11px] text-red-800">エラーID: {error.digest}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-9 items-center rounded-md bg-[#2c60b8] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#24529c]"
          >
            再読み込み
          </button>
          <Link
            href="/portfolio"
            className="inline-flex min-h-9 items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-50"
          >
            ポートフォリオに戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
