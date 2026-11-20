import { MILESTONE_CRITICAL_BACKGROUND, MILESTONE_CRITICAL_RING, MILESTONE_ICON_COLOR } from "@/lib/data-colors";

/** Asana-style green diamond that marks a task as a milestone across views. */
export default function TaskMilestoneIcon({
  className = "",
  sizeClassName = "h-3 w-3",
  completed = false,
  critical = false,
  colorClassName,
  criticalDecoration = true,
}: {
  className?: string;
  sizeClassName?: string;
  completed?: boolean;
  critical?: boolean;
  /** Override the default data color, e.g. the timeline's text/success/accent. */
  colorClassName?: string;
  /** Timeline keeps only the diamond hue, without the red status ring. */
  criticalDecoration?: boolean;
}) {
  const criticalState = critical && !completed;
  const label = criticalState ? "クリティカルパス上のマイルストーン" : "マイルストーン";
  return (
    <span
      data-task-milestone
      data-task-milestone-completed={completed ? "true" : undefined}
      data-task-milestone-critical={criticalState ? "true" : undefined}
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center ${colorClassName ?? MILESTONE_ICON_COLOR} ${
        criticalState && criticalDecoration
          ? `rounded-sm ${MILESTONE_CRITICAL_BACKGROUND} ring-2 ${MILESTONE_CRITICAL_RING}`
          : ""
      } ${sizeClassName} ${className}`}
    >
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path
          d="M20.1 2.8c-2.3-2.3-5.9-2.3-8.2 0L2.7 12c-2.3 2.3-2.3 5.9 0 8.2l9.2 9.2c2.3 2.3 5.9 2.3 8.2 0l9.2-9.2c2.3-2.3 2.3-5.9 0-8.2L20.1 2.8z"
          fill={completed ? "currentColor" : "none"}
        />
        {completed && (
          <path
            d="M13.4 22.2c-0.3 0-0.5-0.1-0.7-0.3L8.8 18c-0.4-0.4-0.4-1 0-1.4s1-0.4 1.4 0l3.1 3.1 8.1-8.1c0.4-0.4 1-0.4 1.4 0s0.4 1 0 1.4l-8.9 8.9c-0.3 0.2-0.5 0.3-0.8 0.3z"
            stroke="var(--atlas-on-strong)"
          />
        )}
      </svg>
    </span>
  );
}
