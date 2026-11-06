"use client";

import Link from "next/link";

export default function ErrorState({
  error,
  reset,
  scope = "page",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope?: string;
}) {
  return (
    <div data-error-state={scope} className="flex min-h-[320px] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-lg text-red-600">
          !
        </div>
        <h1 className="mt-3 text-[16px] font-semibold text-neutral-900">読み込みに失敗しました</h1>
        <p className="mt-1 text-[13px] leading-5 text-neutral-500">
          通信状況を確認して、もう一度お試しください。
        </p>
        {error.digest && <p className="mt-2 text-[11px] text-neutral-400">参照ID: {error.digest}</p>}
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            data-error-retry
            onClick={() => reset()}
            className="h-8 rounded-md bg-[#2c60b8] px-4 text-[13px] font-medium text-white hover:bg-[#24529c]"
          >
            再試行
          </button>
          <Link href="/" className="h-8 rounded-md border border-neutral-200 px-3 text-[13px] leading-8 text-neutral-600 hover:bg-neutral-50">
            ホームへ
          </Link>
        </div>
      </div>
    </div>
  );
}
