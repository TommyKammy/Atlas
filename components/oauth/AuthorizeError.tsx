import Link from "next/link";

export function AuthorizeError({
  message,
  title = "Atlas に接続できません",
}: {
  message: string;
  title?: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-8">
      <div
        role="alert"
        data-oauth-error
        className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-card"
      >
        <h1 className="text-[16px] font-semibold leading-6 text-text">{title}</h1>
        <p className="mt-2 text-[13px] leading-5 text-secondary">{message}</p>
        <Link
          href="/"
          className="mt-4 inline-flex text-[13px] text-accent-text hover:underline"
        >
          ホームへ戻る
        </Link>
      </div>
    </div>
  );
}
