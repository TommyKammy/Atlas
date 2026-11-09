/** Small gold diamond that marks a task as a milestone across project views. */
export default function TaskMilestoneIcon({ className = "" }: { className?: string }) {
  return (
    <span
      data-task-milestone
      title="マイルストーン"
      aria-label="マイルストーン"
      className={`inline-flex shrink-0 items-center text-[#b47a12] ${className}`}
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
        <path d="M8 1.3 14.7 8 8 14.7 1.3 8z" />
      </svg>
    </span>
  );
}
