"use client";

/** Inline, dismissible error banner for client views. */
export default function InlineError({
  message,
  onDismiss,
  className = "",
}: {
  message: string | null | undefined;
  onDismiss?: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      data-inline-error
      className={`flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 ${className}`}
    >
      <span className="min-w-0 flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="エラーを閉じる"
          className="shrink-0 text-red-500 hover:text-red-700"
        >
          ×
        </button>
      )}
    </div>
  );
}
