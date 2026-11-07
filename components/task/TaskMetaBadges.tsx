/** Subtask/comment count badges shared by board, calendar and list rows. */
export default function TaskMetaBadges({
  subtaskCount,
  commentCount,
  dataScope,
  className = "flex items-center gap-0.5",
  iconClassName = "h-3.5 w-3.5",
}: {
  subtaskCount: number;
  commentCount: number;
  dataScope?: "board" | "calendar";
  className?: string;
  iconClassName?: string;
}) {
  if (subtaskCount <= 0 && commentCount <= 0) return null;
  const subtaskData = dataScope ? { [`data-${dataScope}-subtask-badge`]: true } : {};
  const commentData = dataScope ? { [`data-${dataScope}-comment-badge`]: true } : {};
  return (
    <>
      {subtaskCount > 0 && (
        <span {...subtaskData} className={className} title="サブタスク">
          <svg viewBox="0 0 16 16" className={iconClassName} fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M4 3v4.5a2 2 0 0 0 2 2h6" />
            <path d="M9.5 7.5 12 9.5 9.5 11.5" />
          </svg>
          {subtaskCount}
        </span>
      )}
      {commentCount > 0 && (
        <span {...commentData} className={className} title="コメント">
          <svg viewBox="0 0 16 16" className={iconClassName} fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
          </svg>
          {commentCount}
        </span>
      )}
    </>
  );
}
