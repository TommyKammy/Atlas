"use client";

import type { ReactNode } from "react";
import Dialog from "../ui/Dialog";

/** Shared modal shell for ProjectCustomize editors. */
export default function CustomizeModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      backdropClassName="backdrop:bg-black/25"
      panelClassName="w-[min(560px,94vw)] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-line-subtle px-5 py-4">
        <h3 className="text-[17px] font-semibold text-text">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="flex h-7 w-7 items-center justify-center rounded-md text-xl leading-none text-muted hover:bg-hover"
        >
          ×
        </button>
      </div>
      {children}
    </Dialog>
  );
}
