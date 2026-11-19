import type { ListRowState } from "@/lib/list-row-state";

const stateColor: Record<ListRowState, string> = {
  complete: "text-success",
  overdue: "text-danger",
  "in-progress": "text-warning",
  todo: "text-muted",
};

/**
 * Display-only copy of the list's four-state circle. Interactive callers use
 * TaskCompletionToggle; this version is for bars that keep a separate hit
 * target (the timeline bar itself) and therefore hide the icon from assistive
 * technology. The state word always accompanies it in the bar's label.
 */
export default function TaskStateIcon({
  state,
  className = "",
  sizeClassName = "h-[15px] w-[15px]",
}: {
  state: ListRowState;
  className?: string;
  sizeClassName?: string;
}) {
  return (
    <svg
      data-task-state-icon={state}
      viewBox="0 0 24 24"
      className={`inline-block shrink-0 ${sizeClassName} ${stateColor[state]} ${className}`}
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
