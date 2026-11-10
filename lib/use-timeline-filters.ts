"use client";

import { useCallback, useMemo, useState } from "react";
import type { TaskTimelineRow } from "./timeline-task-payload";
import {
  parseListDateFilter,
  taskMatchesListFilters,
  type ListDateFilter,
  type ListFilters,
} from "./list-view";
import { todayISO } from "./dates";
import { dayOrNull } from "./task-dates";

type StoredState = Record<string, string | number | boolean | null>;

export type TimelineSortKey = "default" | "due" | "start" | "assignee";

/**
 * Timeline filter state, persistence payload and derived task buckets.
 * Keeping this out of TimelineView means the render tree only sees the
 * already-filtered tasks and a single change handler.
 */
export function useTimelineFilters({
  tasks,
  initialState,
  viewerId,
  statusFieldEnabled,
}: {
  tasks: TaskTimelineRow[];
  initialState?: StoredState;
  viewerId: number;
  statusFieldEnabled: boolean;
}) {
  const stored = initialState ?? {};
  const storedSort: TimelineSortKey =
    stored.sort === "due" || stored.sort === "start" || stored.sort === "assignee"
      ? (stored.sort as TimelineSortKey)
      : "default";

  const [hideCompleted, setHideCompleted] = useState(stored.hide_completed === true);
  const [completedOnly, setCompletedOnly] = useState(stored.completed_only === true);
  const [mineOnly, setMineOnly] = useState(stored.mine_only === true);
  const [assigneeFilter, setAssigneeFilter] = useState(
    typeof stored.assignee === "string" && stored.assignee !== "all" ? stored.assignee : "",
  );
  const [statusFilter, setStatusFilter] = useState(
    typeof stored.status === "string" ? stored.status : "",
  );
  const [dueFilter, setDueFilter] = useState(typeof stored.due === "string" ? stored.due : "");
  const [startFilter, setStartFilter] = useState<ListDateFilter>(() => parseListDateFilter(stored.start));
  const [creatorFilter, setCreatorFilter] = useState(
    typeof stored.creator === "string" ? stored.creator : "",
  );
  const [createdFilter, setCreatedFilter] = useState<ListDateFilter>(() => parseListDateFilter(stored.created));
  const [updatedFilter, setUpdatedFilter] = useState<ListDateFilter>(() => parseListDateFilter(stored.updated));
  const [completedDateFilter, setCompletedDateFilter] = useState<ListDateFilter>(() =>
    parseListDateFilter(stored.completed_on),
  );
  const [sortBy, setSortBy] = useState<TimelineSortKey>(storedSort);

  const timelineToday = todayISO();
  const shiftTimelineDay = useCallback((days: number) => {
    const date = new Date(`${timelineToday}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }, [timelineToday]);

  const filters: ListFilters = {
    hide_completed: hideCompleted,
    completed_only: completedOnly,
    mine_only: mineOnly,
    assignee: assigneeFilter,
    status: statusFilter,
    due: dueFilter,
    start: startFilter,
    creator: creatorFilter,
    created: createdFilter,
    updated: updatedFilter,
    completed_on: completedDateFilter,
  };

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) =>
        taskMatchesListFilters(task, filters, {
          today: timelineToday,
          viewerId,
          statusFieldEnabled,
          dayOffset: shiftTimelineDay,
        }),
      ),
    // filter fields are primitives; recreating the predicate each render is cheap
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, hideCompleted, completedOnly, mineOnly, assigneeFilter, statusFilter, dueFilter, startFilter, creatorFilter, createdFilter, updatedFilter, completedDateFilter, viewerId, statusFieldEnabled, timelineToday, shiftTimelineDay],
  );

  const dated = useMemo(
    () => visibleTasks.filter((t) => dayOrNull(t.start_on) !== null || dayOrNull(t.due_on) !== null),
    [visibleTasks],
  );
  const undated = useMemo(
    () => visibleTasks.filter((t) => dayOrNull(t.start_on) === null && dayOrNull(t.due_on) === null),
    [visibleTasks],
  );

  // Vertical reorder maps directly to task.position. Disable it while a
  // non-default sort or a filter hides rows, so the visual order stays truthful.
  const canReorder = sortBy === "default" && !hideCompleted && assigneeFilter === "";

  const activeFilterCount =
    (hideCompleted ? 1 : 0) +
    (completedOnly ? 1 : 0) +
    (mineOnly ? 1 : 0) +
    (assigneeFilter !== "" ? 1 : 0) +
    (statusFieldEnabled && statusFilter !== "" ? 1 : 0) +
    (dueFilter !== "" ? 1 : 0) +
    (startFilter !== "" ? 1 : 0) +
    (creatorFilter !== "" ? 1 : 0) +
    (createdFilter !== "" ? 1 : 0) +
    (updatedFilter !== "" ? 1 : 0) +
    (completedDateFilter !== "" ? 1 : 0);

  const setTimelineFilter = (key: keyof ListFilters, value: string | boolean) => {
    if (key === "hide_completed") setHideCompleted(value === true);
    else if (key === "completed_only") setCompletedOnly(value === true);
    else if (key === "mine_only") setMineOnly(value === true);
    else if (key === "assignee") setAssigneeFilter(String(value));
    else if (key === "status") setStatusFilter(String(value));
    else if (key === "due") setDueFilter(String(value));
    else if (key === "start") setStartFilter(parseListDateFilter(value));
    else if (key === "creator") setCreatorFilter(String(value));
    else if (key === "created") setCreatedFilter(parseListDateFilter(value));
    else if (key === "updated") setUpdatedFilter(parseListDateFilter(value));
    else if (key === "completed_on") setCompletedDateFilter(parseListDateFilter(value));
  };

  const clearTimelineFilters = () => {
    setHideCompleted(false);
    setCompletedOnly(false);
    setMineOnly(false);
    setAssigneeFilter("");
    setStatusFilter("");
    setDueFilter("");
    setStartFilter("");
    setCreatorFilter("");
    setCreatedFilter("");
    setUpdatedFilter("");
    setCompletedDateFilter("");
  };

  const persistedState = useMemo(() => ({
    hide_completed: hideCompleted,
    completed_only: completedOnly,
    mine_only: mineOnly,
    assignee: assigneeFilter,
    status: statusFilter,
    due: dueFilter,
    start: startFilter,
    creator: creatorFilter,
    created: createdFilter,
    updated: updatedFilter,
    completed_on: completedDateFilter,
    sort: sortBy,
  }), [
    hideCompleted, completedOnly, mineOnly, assigneeFilter, statusFilter, dueFilter,
    startFilter, creatorFilter, createdFilter, updatedFilter, completedDateFilter, sortBy,
  ]);

  return {
    filters,
    visibleTasks,
    dated,
    undated,
    canReorder,
    activeFilterCount,
    setTimelineFilter,
    clearTimelineFilters,
    persistedState,
    hideCompleted,
    completedOnly,
    mineOnly,
    assigneeFilter,
    statusFilter,
    dueFilter,
    startFilter,
    creatorFilter,
    createdFilter,
    updatedFilter,
    completedDateFilter,
    sortBy,
    setSortBy,
  };
}
