"use client";

/** Small status line for pending mutations and their errors. */
export default function MutationFeedback({
  pending = false,
  error = null,
  pendingLabel = "保存中…",
  className = "",
}: {
  pending?: boolean;
  error?: unknown;
  pendingLabel?: string;
  className?: string;
}) {
  if (!pending && !error) return null;
  const message = error instanceof Error ? error.message : error ? String(error) : "";
  return (
    <div
      data-mutation-feedback
      role={error ? "alert" : "status"}
      className={`text-[11px] ${error ? "text-red-600" : "text-neutral-500"} ${className}`}
    >
      {error ? message : pendingLabel}
    </div>
  );
}
