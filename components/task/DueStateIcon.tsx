/**
 * Small shape cue for a due date's state. Always paired with sr-only text or
 * an aria-label at the call site, so the state is never carried by color alone.
 */
export default function DueStateIcon({
  state,
  className = "",
  sizeClassName = "h-3 w-3",
}: {
  state: "overdue" | "today";
  className?: string;
  sizeClassName?: string;
}) {
  if (state === "overdue") {
    return (
      <svg
        data-due-state="overdue"
        viewBox="0 0 16 16"
        className={`inline-block shrink-0 ${sizeClassName} ${className}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        <path d="M8 2.5 14.5 13.5h-13L8 2.5Z" strokeLinejoin="round" />
        <path d="M8 6v3.5" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="0.65" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg
      data-due-state="today"
      viewBox="0 0 16 16"
      className={`inline-block shrink-0 ${sizeClassName} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
