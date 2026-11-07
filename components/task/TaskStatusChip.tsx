import { statusToneClass } from "@/lib/task-appearance";

/** Status pill shared by list, board, calendar and task pane. */
export default function TaskStatusChip({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  return (
    <span className={`${statusToneClass(status)} ${compact ? "px-1.5" : ""}`}>{status}</span>
  );
}
