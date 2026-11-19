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
      <div className="flex h-[38px] items-center gap-2 pl-[56px] text-[14px] font-semibold text-muted">
        <span>（セクションなし）</span>
        <span className="text-[12px] font-normal">{total}</span>
      </div>
      {tasks.map((task) => (
        <TaskListRow key={task.id} task={task} ctx={rowCtx} />
      ))}
      {footer}
    </div>
  );
}
