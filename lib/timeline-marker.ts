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

/**
 * Asana keeps labels inside multi-day bars at coarse zoom and only moves
 * single-day/milestone labels outside. At day/week zoom Atlas keeps the
 * external label for very short multi-day bars so the name stays readable.
 */
export function usesTimelineExternalLabel(
  task: Pick<TaskRow, "start_on" | "due_on" | "is_milestone">,
  barPx: number,
  dayWidth: number,
): boolean {
  if (task.is_milestone || isSingleDayTimelineTask(task)) return true;
  return dayWidth >= 24 && barPx < 52;
}
