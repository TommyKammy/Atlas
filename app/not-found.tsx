import Link from "next/link";

export default function NotFound() {
  return (
    <div data-not-found className="flex min-h-[360px] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 text-center shadow-sm">
        <div className="text-[32px] font-semibold text-subtle">404</div>
        <h1 className="mt-1 text-[16px] font-semibold text-text">ページが見つかりません</h1>
        <p className="mt-1 text-[13px] text-muted">リンクが無効か、削除された可能性があります。</p>
        <Link href="/" className="mt-4 inline-flex h-8 items-center rounded-md bg-accent px-4 text-[13px] font-medium text-on-accent hover:bg-accent-hover">
          ホームへ戻る
        </Link>
      </div>
    </div>
  );
}
