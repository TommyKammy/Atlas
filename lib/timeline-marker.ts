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

type TimelineLabelTask = Pick<
  TaskRow,
  "start_on" | "due_on" | "is_milestone" | "name" | "assignee_name" | "subtask_count"
>;

// The 12px bar uses 8px padding on both sides and a 1px border. The leading
// state slot is 16px plus a 6px gap; the avatar and the subtask count use the
// same 6px gap. These are the same thresholds TimelineBar uses to render each
// item, so the fit decision and the actual content stay in sync.
const BAR_PADDING = 16;
const BAR_BORDER = 2;
const STATE_SLOT = 16 + 6;
const AVATAR = 20 + 6;
const SUBTASK = 20 + 6;
const STATE_IN_BAR_MIN = 36;
const AVATAR_MIN = 140;
const SUBTASK_MIN = 160;
/** A bar keeps its name inside when this much room remains (about five
 * Japanese characters), even if the full name has to be ellipsized. */
export const TIMELINE_MIN_NAME_WIDTH = 60;

/** Rough advance width for the 12px Japanese UI font. */
export function estimateTimelineTextWidth(name: string): number {
  return [...name].reduce(
    (width, char) => width + (char.charCodeAt(0) > 0x2e80 ? 12 : 7),
    0,
  );
}

/** Whether the four-state circle is rendered inside the bar rather than in the
 * external label. Single-day markers always keep it outside. */
export function timelineStateInBar(
  task: Pick<TaskRow, "start_on" | "due_on" | "is_milestone">,
  barPx: number,
): boolean {
  return !task.is_milestone && !isSingleDayTimelineTask(task) && barPx >= STATE_IN_BAR_MIN;
}

/** The external label includes a state circle when the bar itself cannot. */
export function timelineExternalLabelShowsState(
  task: Pick<TaskRow, "start_on" | "due_on" | "is_milestone">,
  barPx: number,
): boolean {
  return !task.is_milestone && !timelineStateInBar(task, barPx);
}

/**
 * External labels are used for single-day/milestone markers. A multi-day bar
 * keeps its name inside when at least a few characters fit (about five), so a
 * wide bar with a long name ellipsizes instead of emptying the bar. At month
 * and coarser zooms the previous behavior is kept: multi-day names stay in
 * the bar, which also preserves lane packing.
 *
 * The available width includes the leading state circle, avatar and subtask
 * count, not just the bar width.
 */
export function usesTimelineExternalLabel(
  task: TimelineLabelTask,
  barPx: number,
  dayWidth: number,
): boolean {
  if (task.is_milestone || isSingleDayTimelineTask(task)) return true;
  if (dayWidth < 24) return false;
  // Below this width the state circle itself does not fit; the external label
  // carries the state circle instead.
  if (barPx < STATE_IN_BAR_MIN) return true;

  const leading =
    STATE_SLOT +
    (task.assignee_name && barPx >= AVATAR_MIN ? AVATAR : 0) +
    (task.subtask_count > 0 && barPx >= SUBTASK_MIN ? SUBTASK : 0);
  const available = barPx - BAR_PADDING - BAR_BORDER - leading;
  const required = Math.min(estimateTimelineTextWidth(task.name), TIMELINE_MIN_NAME_WIDTH);
  return available < required;
}
