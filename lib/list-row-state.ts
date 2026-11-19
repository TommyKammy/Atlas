import type { TaskRow } from "./data";

/** The four row states shown by the list completion control. */
export type ListRowState = "complete" | "overdue" | "in-progress" | "todo";

type ListRowStateTask = Pick<TaskRow, "completed" | "due_on" | "progress">;

export const LIST_ROW_STATE_LABELS: Record<ListRowState, string> = {
  complete: "完了",
  overdue: "遅延",
  "in-progress": "進行中",
  todo: "未着手",
};

/**
 * Derive the row state from data the list already loads.
 *
 * Completed wins over a past due date because a finished task is no longer
 * late. Overdue wins over progress because the mockup shows a delayed task
 * that is 60% done with the overdue icon. Progress above zero is the only
 * existing "work has started" signal: the status field is free text and can
 * be disabled per project, while progress is always present on TaskRow.
 */
export function listRowState(task: ListRowStateTask, today: string): ListRowState {
  if (task.completed) return "complete";
  if (task.due_on !== null && task.due_on < today) return "overdue";
  if (task.progress > 0) return "in-progress";
  return "todo";
}

export type ListTaskSummary = {
  total: number;
  completed: number;
  overdue: number;
};

/** Counts for the summary line above the list, over the filtered tasks. */
export function listTaskSummary(
  tasks: readonly ListRowStateTask[],
  today: string,
): ListTaskSummary {
  let completed = 0;
  let overdue = 0;
  for (const task of tasks) {
    if (task.completed) completed += 1;
    else if (task.due_on !== null && task.due_on < today) overdue += 1;
  }
  return { total: tasks.length, completed, overdue };
}

/** "24件 ・ 完了 9 ・ 期限超過 1". The overdue part is omitted at zero. */
export function listSummaryText(summary: ListTaskSummary): string {
  const parts = [`${summary.total}件`, `完了 ${summary.completed}`];
  if (summary.overdue > 0) parts.push(`期限超過 ${summary.overdue}`);
  return parts.join(" ・ ");
}
