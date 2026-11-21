import type { ListRowState } from "@/lib/list-row-state";

const stateColor: Record<ListRowState, string> = {
  complete: "text-success",
  overdue: "text-danger",
  "in-progress": "text-warning",
  todo: "text-muted",
};

/**
 * Circle geometry in the 24-unit viewBox.
 * - "compact" (default): r=9, for tight places such as timeline bars and
 *   search results.
 * - "large": r=10.5 with a lighter stroke. At an 18px box the circle is about
 *   16px across with a ~1.5px line, matching Asana's list completion circle.
 */
const GEOMETRY = {
  compact: { r: 9, stroke: 2.2, half: "M12 3a9 9 0 0 1 0 18z" },
  large: { r: 10.5, stroke: 2, half: "M12 1.5a10.5 10.5 0 0 1 0 21z" },
} as const;

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
  variant = "compact",
}: {
  state: ListRowState;
  className?: string;
  sizeClassName?: string;
  variant?: keyof typeof GEOMETRY;
}) {
  const shape = GEOMETRY[variant];
  return (
    <svg
      data-task-state-icon={state}
      viewBox="0 0 24 24"
      className={`inline-block shrink-0 ${sizeClassName} ${stateColor[state]} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={shape.stroke}
      aria-hidden="true"
    >
      {state === "complete" ? (
        <>
          {/* Done: a filled green disc with a white check, like Asana. */}
          <circle cx="12" cy="12" r={shape.r} className="fill-success-strong stroke-success-strong" />
          <path d="M7.5 12.2l3.2 3.2 5.8-6.6" className="stroke-on-strong" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <circle cx="12" cy="12" r={shape.r} />
      )}
      {state === "overdue" && <path d="M12 6.8v6.4M12 16.6v.6" />}
      {state === "in-progress" && <path d={shape.half} fill="currentColor" />}
    </svg>
  );
}
