"use client";

import type { ReactNode } from "react";

/** Section heading used by the Asana-style task pane sections. */
export default function TaskSectionHeading({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-1 flex min-h-8 items-center gap-1.5">
      <h3 className="text-[12px] font-semibold text-neutral-700">{title}</h3>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-surface-muted px-1.5 text-[10px] font-medium leading-4 text-muted">
          {count}
        </span>
      )}
      {action}
      {children}
    </div>
  );
}
