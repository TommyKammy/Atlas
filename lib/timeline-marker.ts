import type { TaskRow } from "./data";

/**
 * True when a timeline item occupies a single day. Milestones are single-day
 * markers by definition; regular tasks are single-day when their effective
 * start and due dates are the same (including only-one-date tasks).
 */
export function isSingleDayTimelineTask(
  task: Pick<TaskRow, "start_on" | "due_on" | "is_milestone">,
): boolean {
  if (task.is_milestone) return true;
  const start = task.start_on ?? task.due_on;
  const end = task.due_on ?? task.start_on;
  return start !== null && end !== null && start === end;
}
