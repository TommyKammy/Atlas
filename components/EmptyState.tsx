import type { ReactNode } from "react";

export default function EmptyState({
  title,
  description,
  action,
  scope = "default",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  scope?: string;
}) {
  return (
    <div
      data-empty-state={scope}
      className="mx-2 my-4 rounded-lg border border-dashed border-line bg-surface px-5 py-8 text-center"
    >
      <div className="text-[14px] font-semibold text-secondary">{title}</div>
      {description && <p className="mx-auto mt-1 max-w-md text-[13px] leading-5 text-muted">{description}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
