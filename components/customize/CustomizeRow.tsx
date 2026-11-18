"use client";

import type { ReactNode } from "react";
import { Chevron } from "./icons";

export default function CustomizeRow({
  icon,
  title,
  description,
  count,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-customize-row={title}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-[#e1e1e1] bg-surface px-4 py-3 text-left transition-colors hover:border-[#cfcfcf] hover:bg-hover"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-secondary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-text">{title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-muted">{description}</span>
      </span>
      {count !== undefined && <span className="shrink-0 text-[12px] text-muted">{count}</span>}
      <Chevron />
    </button>
  );
}
