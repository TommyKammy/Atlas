"use client";

import type { ReactNode } from "react";
import type { TaskRow } from "@/lib/data";
import TaskListRow, { type TaskRowContext } from "./TaskListRow";

/** Rows without a section (section_id = null) and their show-more control. */
export default function ListUngroupedSection({
  total,
  tasks,
  rowCtx,
  footer,
}: {
  total: number;
  tasks: TaskRow[];
  rowCtx: TaskRowContext;
  footer: ReactNode;
}) {
  if (total === 0) return null;
  return (
    <div data-list-unsectioned>
      <div className="flex h-[37px] items-center pl-[56px] text-[14px] font-semibold text-muted">
        （セクションなし）
      </div>
      {tasks.map((task) => (
        <TaskListRow key={task.id} task={task} ctx={rowCtx} />
      ))}
      {footer}
    </div>
  );
}
