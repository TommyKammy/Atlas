"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-line-strong bg-surface px-3 py-1 text-sm text-secondary hover:bg-neutral-50 print:hidden"
    >
      印刷
    </button>
  );
}
