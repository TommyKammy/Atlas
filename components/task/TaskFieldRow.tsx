import type { ReactNode } from "react";

/**
 * Two-column row for the task pane's properties. The label column is 80px in
 * the C workbench mockup; rows use the parent's vertical gap instead of a
 * divider so a group reads as one block.
 */
export default function TaskFieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] items-start gap-x-3">
      <span className="truncate pt-1 text-[12px] leading-5 text-muted" title={label}>
        {label}
      </span>
      <div className="min-w-0 text-[13px] text-text">{children}</div>
    </div>
  );
}
