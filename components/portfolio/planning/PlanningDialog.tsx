"use client";

import { useId, type ReactNode } from "react";
import Dialog from "@/components/ui/Dialog";

export default function PlanningDialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      titleId={titleId}
      panelClassName={`${
        wide ? "w-[min(820px,94vw)]" : "w-[min(580px,94vw)]"
      } flex max-h-[min(88dvh,900px)] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <h2 id={titleId} className="text-[15px] font-semibold text-neutral-900">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[20px] leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        >
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      {footer && (
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-4 py-3">
          {footer}
        </footer>
      )}
    </Dialog>
  );
}
