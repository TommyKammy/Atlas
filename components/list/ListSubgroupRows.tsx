"use client";

import type { ReactNode } from "react";
import type { TaskRow } from "@/lib/data";
import type { ListGroupBy } from "@/lib/list-view";
import TaskListRow, { type TaskRowContext } from "./TaskListRow";

/**
 * Renders a group's rows, splitting once more when a secondary group is set.
 * The `data-list-subgroup` contract is kept on the wrapper element.
 */
export default function ListSubgroupRows({
  items,
  baseKey,
  group2,
  collapsedGroups,
  splitGroups,
  rowCtx,
  renderGroupHeader,
}: {
  items: TaskRow[];
  baseKey: string;
  group2: ListGroupBy | null;
  collapsedGroups: Set<string>;
  splitGroups: (items: TaskRow[], key: ListGroupBy) => [string, TaskRow[]][];
  rowCtx: TaskRowContext;
  renderGroupHeader: (
    key: string,
    name: string,
    count: number,
    depth?: number,
    sectionId?: number,
  ) => ReactNode;
}) {
  if (group2 !== null) {
    return (
      <>
        {splitGroups(items, group2).map(([subKey, subItems]) => {
          const key = `${baseKey}|g:${subKey}`;
          const collapsed = collapsedGroups.has(key);
          return (
            <div key={subKey} data-list-subgroup={subKey}>
              {renderGroupHeader(key, subKey, subItems.length, 1)}
              {!collapsed &&
                subItems.map((task) => <TaskListRow key={task.id} task={task} ctx={rowCtx} />)}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {items.map((task) => (
        <TaskListRow key={task.id} task={task} ctx={rowCtx} />
      ))}
    </>
  );
}
