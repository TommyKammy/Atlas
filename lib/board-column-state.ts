import type { ListRowState } from "./list-row-state";

/**
 * Status values that unambiguously map to the list's four-state circle.
 *
 * The status field is free text and projects define their own options, so only
 * the labels with a clear completion/progress meaning get an icon. Custom
 * statuses keep the plain heading instead of guessing a state.
 */
const STATUS_STATES: Record<string, ListRowState> = {
  "未着手": "todo",
  "to do": "todo",
  "todo": "todo",
  "進行中": "in-progress",
  "in progress": "in-progress",
  "doing": "in-progress",
  "完了": "complete",
  "done": "complete",
  "complete": "complete",
  "completed": "complete",
  "期限超過": "overdue",
  "遅延": "overdue",
  "overdue": "overdue",
  "要対応": "overdue",
};

/** The state icon for a status column, or null when the label is not known. */
export function boardColumnState(status: string | null | undefined): ListRowState | null {
  if (!status) return null;
  return STATUS_STATES[status.trim().toLowerCase()] ?? null;
}
