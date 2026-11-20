import Link from "next/link";
import type { TaskApprovalSummary } from "@/lib/task-approval";
import { TASK_APPROVAL_STATUS_LABELS } from "@/lib/task-approval";

export default function TaskApprovalBadge({ approval, href, onClick }: {
  approval: TaskApprovalSummary;
  href?: string;
  onClick?: () => void;
}) {
  const className = `inline-flex max-w-full shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
    approval.status === "approved" ? "bg-success-soft text-success"
      : approval.status === "pending" ? "bg-warning-soft text-warning"
        : approval.status === "rejected" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
  }`;
  const label = TASK_APPROVAL_STATUS_LABELS[approval.status];
  const title = `${label}${approval.approver_name ? ` · 承認者: ${approval.approver_name}` : ""}`;
  const content = <><span aria-hidden="true">{approval.status === "approved" ? "✓" : approval.status === "pending" ? "◇" : "↩"}</span><span className="truncate">{label}</span></>;
  if (href) return <Link href={href} className={className} title={title} aria-label={`${label}、承認の詳細を開く`} data-approval-status={approval.status} onClick={(event) => event.stopPropagation()}>{content}</Link>;
  if (onClick) return <button type="button" className={className} title={title} aria-label={`${label}、承認の詳細を開く`} data-approval-status={approval.status} onClick={(event) => { event.stopPropagation(); onClick(); }}>{content}</button>;
  return <span className={className} title={title} data-approval-status={approval.status}>{content}</span>;
}
