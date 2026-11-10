/** Public approval-task contract. Waiting/resuming workflows are intentionally separate. */
export const TASK_APPROVAL_STATUSES = ["pending", "approved", "rejected", "changes_requested"] as const;
export type TaskApprovalStatus = (typeof TASK_APPROVAL_STATUSES)[number];

export const TASK_APPROVAL_ACTIONS = ["request", "approve", "reject", "request_changes", "resubmit", "reassign"] as const;
export type TaskApprovalAction = (typeof TASK_APPROVAL_ACTIONS)[number];

export const TASK_APPROVAL_STATUS_LABELS: Record<TaskApprovalStatus, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  changes_requested: "差し戻し",
};

export const TASK_APPROVAL_ACTION_LABELS: Record<TaskApprovalAction, string> = {
  request: "承認を申請しました",
  approve: "承認しました",
  reject: "却下しました",
  request_changes: "差し戻しました",
  resubmit: "承認を再申請しました",
  reassign: "承認者を変更しました",
};

export type TaskApprovalSummary = {
  status: TaskApprovalStatus;
  approver_id: number | null;
  approver_name: string | null;
  version: number;
  round: number;
};

export type TaskApprovalDetail = TaskApprovalSummary & {
  task_id: number;
  requester_id: number | null;
  requester_name: string | null;
  requested_at: string;
  decided_at: string | null;
  task_updated_at: string;
};

export type TaskApprovalHistoryEntry = {
  id: number;
  action: TaskApprovalAction;
  round: number;
  version: number;
  actor_id: number | null;
  actor_name: string;
  approver_id: number | null;
  approver_name: string;
  comment: string;
  created_at: string;
};

export type TaskApprovalResponse = {
  task_updated_at: string;
  approval: TaskApprovalDetail | null;
  history: TaskApprovalHistoryEntry[];
  eligible_approvers: { id: number; name: string }[];
  can_request: boolean;
  can_manage: boolean;
  can_decide: boolean;
};
