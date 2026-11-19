import type { TaskRow } from "./data";
import { LIST_ROW_STATE_LABELS, listRowState, type ListRowState } from "./list-row-state";

const DAY_MS = 86_400_000;

function dayValue(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Whole calendar days a task is past due. Returns 0 for tasks that are due
 * today, due later, or have no due date, so callers can render the badge only
 * when the value is positive. Uses UTC day numbers to stay stable across DST.
 */
export function overdueDays(dueOn: string | null, today: string): number {
  if (!dueOn) return 0;
  const difference = Math.round((dayValue(today) - dayValue(dueOn)) / DAY_MS);
  return difference > 0 ? difference : 0;
}

/** "3日 超過" for the overdue badge. */
export function overdueBadgeText(days: number): string {
  return `${days}日 超過`;
}

export type TaskStateSummary = {
  state: ListRowState;
  label: string;
  progress: number;
  text: string;
};

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

/**
 * "進行中 ・ 60%" for the pane's top row. The state word comes from the same
 * judgment as the list completion control, so the pane and the list agree on
 * complete / overdue / in-progress / todo.
 */
export function taskStateSummary(
  task: Pick<TaskRow, "completed" | "due_on" | "progress">,
  today: string,
): TaskStateSummary {
  const state = listRowState(task, today);
  const progress = clampProgress(task.progress);
  return {
    state,
    label: LIST_ROW_STATE_LABELS[state],
    progress,
    text: `${LIST_ROW_STATE_LABELS[state]} ・ ${progress}%`,
  };
}

/** "1 / 2" for the subtask heading; completed first, total second. */
export function subtaskProgressText(completed: number, total: number): string {
  return `${Math.max(0, completed)} / ${Math.max(0, total)}`;
}

export type SubtaskSummary = {
  completed: number;
  total: number;
  text: string;
};

/** Completion counts for the subtask heading. */
export function subtaskSummary(subtasks: readonly Pick<TaskRow, "completed">[]): SubtaskSummary {
  const completed = subtasks.filter((subtask) => subtask.completed).length;
  return {
    completed,
    total: subtasks.length,
    text: subtaskProgressText(completed, subtasks.length),
  };
}
