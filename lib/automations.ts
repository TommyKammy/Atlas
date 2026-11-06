export type AutomationTrigger = "task_created" | "task_completed" | "status_changed";
export type AutomationAction = "set_status" | "set_assignee" | "add_comment";

export type ProjectAutomation = {
  id: number;
  project_id: number;
  name: string;
  trigger: AutomationTrigger;
  action_type: AutomationAction;
  action_value: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export const AUTOMATION_TRIGGERS: { value: AutomationTrigger; label: string }[] = [
  { value: "task_created", label: "タスクが作成されたとき" },
  { value: "task_completed", label: "タスクが完了したとき" },
  { value: "status_changed", label: "Statusが変更されたとき" },
];

export const AUTOMATION_ACTIONS: { value: AutomationAction; label: string }[] = [
  { value: "set_status", label: "Statusを変更" },
  { value: "set_assignee", label: "担当者を変更" },
  { value: "add_comment", label: "コメントを追加" },
];

export function isAutomationTrigger(value: unknown): value is AutomationTrigger {
  return value === "task_created" || value === "task_completed" || value === "status_changed";
}

export function isAutomationAction(value: unknown): value is AutomationAction {
  return value === "set_status" || value === "set_assignee" || value === "add_comment";
}
