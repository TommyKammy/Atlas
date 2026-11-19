"use client";

import type { ReactNode } from "react";

/**
 * Section heading used by the task pane sections. Groups are separated by the
 * heading and the section's top margin, not by a divider.
 */
export default function TaskSectionHeading({
  title,
  count,
  countText,
  action,
  children,
}: {
  title: string;
  count?: number;
  countText?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const suffix = countText ?? (count !== undefined && count > 0 ? String(count) : undefined);
  return (
    <div className="mb-1.5 flex min-h-7 items-center gap-2">
      <h3 className="shrink-0 text-[12px] font-medium text-muted">
        {suffix !== undefined ? `${title} ${suffix}` : title}
      </h3>
      {action}
      {children}
    </div>
  );
}
