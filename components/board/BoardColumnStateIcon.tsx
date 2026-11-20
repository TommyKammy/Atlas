import type { ListRowState } from "@/lib/list-row-state";

const stateColor: Record<ListRowState, string> = {
  complete: "text-success",
  overdue: "text-danger",
  "in-progress": "text-warning",
  todo: "text-muted",
};

/**
 * Decorative state cue for a board column whose heading is itself a state
 * (status grouping). Same 14px circle as the list's completion control; the
 * heading text always carries the meaning, so the icon is aria-hidden.
 */
export default function BoardColumnStateIcon({ state }: { state: ListRowState }) {
  return (
    <svg
      data-board-column-state={state}
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 shrink-0 ${stateColor[state]}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      {state === "complete" && <path d="M8 12l3 3 5-6" />}
      {state === "overdue" && <path d="M12 7v6M12 16.5v.5" />}
      {state === "in-progress" && <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />}
    </svg>
  );
}
