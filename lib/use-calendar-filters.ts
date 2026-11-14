"use client";

import { isQuickTask } from "./quick-task";
import { useState } from "react";
import type { TaskRow } from "./data";
import type { CustomValue } from "./custom-fields";
import { formatDay, parseDay, taskSpan, type CalendarSpan } from "./calendar";
import { todayISO } from "./dates";
import { usePersistedViewState } from "./view-state-client";

export type CalendarFilter = {
  completed: "open" | "done" | "";
  assignee: string;
  status: string;
  custom: Record<string, string>;
  due: string;
  created: string;
  updated: string;
  completedOn: string;
  creator: string;
  weekends: boolean;
  multi: boolean;
  color: string;
  weekStart: 0 | 1;
};

export type CalendarDatedTask = CalendarSpan & { task: TaskRow };

/** Pure calendar filter predicate used by the hook and tests. */
export function filterCalendarTasks({
  tasks,
  filters,
  customValues,
  statusFieldEnabled,
  todayDay,
  needle,
}: {
  tasks: TaskRow[];
  filters: Pick<
    CalendarFilter,
    "completed" | "assignee" | "status" | "custom" | "due" | "created" | "updated" | "completedOn" | "creator"
  >;
  customValues: Record<number, Record<number, CustomValue>>;
  statusFieldEnabled: boolean;
  todayDay: number;
  needle: string;
}): TaskRow[] {
  const withinDays = (iso: string | null | undefined, days: number) => {
    if (!iso) return false;
    const day = parseDay(iso.slice(0, 10));
    return day >= todayDay - (days - 1) && day <= todayDay;
  };
  return tasks.filter((t) => {
    if (isQuickTask(t)) return true;
    if (filters.completed === "open" && t.completed) return false;
    if (filters.completed === "done" && !t.completed) return false;
    if (filters.assignee === "none" && t.assignee_id !== null) return false;
    if (filters.assignee && filters.assignee !== "none" && String(t.assignee_id ?? "") !== filters.assignee) return false;
    if (statusFieldEnabled && filters.status && t.status !== filters.status) return false;
    if (filters.creator === "none" && t.created_by !== null) return false;
    if (filters.creator && filters.creator !== "none" && String(t.created_by ?? "") !== filters.creator) return false;
    for (const [fieldId, value] of Object.entries(filters.custom)) {
      if (customValues[t.id]?.[Number(fieldId)]?.value_text !== value) return false;
    }
    if (filters.due) {
      const due = t.due_on ? parseDay(t.due_on) : null;
      if (filters.due === "none" && due !== null) return false;
      if (filters.due === "overdue" && (t.completed || due === null || due >= todayDay)) return false;
      if (filters.due === "today" && due !== todayDay) return false;
      if (filters.due === "week" && (due === null || due < todayDay || due > todayDay + 6)) return false;
      if (filters.due === "nextweek" && (due === null || due < todayDay + 7 || due > todayDay + 13)) return false;
      if (filters.due === "month" && (due === null || due < todayDay || due > todayDay + 29)) return false;
    }
    if (filters.created && !withinDays(t.created_at, filters.created === "today" ? 1 : Number(filters.created))) {
      return false;
    }
    if (filters.updated && !withinDays(t.updated_at, filters.updated === "today" ? 1 : Number(filters.updated))) {
      return false;
    }
    if (
      filters.completedOn &&
      (!t.completed ||
        !t.completed_at ||
        !withinDays(t.completed_at, filters.completedOn === "today" ? 1 : Number(filters.completedOn)))
    ) {
      return false;
    }
    if (needle && !t.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/**
 * Calendar filter state, persistence and derived day buckets.
 * Keeps CalendarView focused on layout and interactions.
 */
export function useCalendarFilters({
  projectId,
  tasks,
  customValues,
  statusFieldEnabled,
  initial,
  colorOptions,
  search,
}: {
  projectId: number;
  tasks: TaskRow[];
  customValues: Record<number, Record<number, CustomValue>>;
  statusFieldEnabled: boolean;
  initial: CalendarFilter;
  colorOptions: { value: string; label: string }[];
  search: string;
}) {
  const [completedFilter, setCompletedFilter] = useState(initial.completed);
  const [assigneeFilter, setAssigneeFilter] = useState(initial.assignee);
  const [statusFilter, setStatusFilter] = useState(initial.status);
  const [customFilter, setCustomFilter] = useState<Record<string, string>>(initial.custom);
  const [dueFilter, setDueFilter] = useState(initial.due);
  const [createdFilter, setCreatedFilter] = useState(initial.created);
  const [updatedFilter, setUpdatedFilter] = useState(initial.updated);
  const [completedOnFilter, setCompletedOnFilter] = useState(initial.completedOn);
  const [creatorFilter, setCreatorFilter] = useState(initial.creator);
  const [showWeekends, setShowWeekends] = useState(initial.weekends);
  const [showMulti, setShowMulti] = useState(initial.multi);
  const [colorBy, setColorBy] = useState(
    colorOptions.some((option) => option.value === initial.color) ? initial.color : "none",
  );
  const [weekStart, setWeekStart] = useState<0 | 1>(initial.weekStart);

  usePersistedViewState(projectId, "calendar", {
    completed: completedFilter,
    hide: completedFilter === "open",
    assignee: assigneeFilter,
    status: statusFilter,
    custom: JSON.stringify(customFilter),
    due: dueFilter,
    created: createdFilter,
    updated: updatedFilter,
    completed_on: completedOnFilter,
    creator: creatorFilter,
    weekends: showWeekends,
    multi: showMulti,
    color: colorBy,
    start: weekStart,
  });

  const needle = search.trim().toLowerCase();
  const todayDay = parseDay(todayISO());
  const visibleTasks = filterCalendarTasks({
    tasks,
    filters: {
      completed: completedFilter,
      assignee: assigneeFilter,
      status: statusFilter,
      custom: customFilter,
      due: dueFilter,
      created: createdFilter,
      updated: updatedFilter,
      completedOn: completedOnFilter,
      creator: creatorFilter,
    },
    customValues,
    statusFieldEnabled,
    todayDay,
    needle,
  });

  const multiSpans: CalendarDatedTask[] = [];
  const singleByDay = new Map<string, TaskRow[]>();
  const pushSingle = (task: TaskRow, day: number) => {
    const key = formatDay(day);
    if (!singleByDay.has(key)) singleByDay.set(key, []);
    singleByDay.get(key)!.push(task);
  };
  for (const task of visibleTasks) {
    const span = taskSpan(task.start_on, task.due_on);
    if (!span) continue;
    if (showMulti && span.end > span.start) {
      multiSpans.push({ id: task.id, start: span.start, end: span.end, task });
    } else {
      pushSingle(task, span.end);
    }
  }
  const undated = visibleTasks.filter((t) => !t.start_on && !t.due_on);

  return {
    completedFilter,
    setCompletedFilter,
    assigneeFilter,
    setAssigneeFilter,
    statusFilter,
    setStatusFilter,
    customFilter,
    setCustomFilter,
    dueFilter,
    setDueFilter,
    createdFilter,
    setCreatedFilter,
    updatedFilter,
    setUpdatedFilter,
    completedOnFilter,
    setCompletedOnFilter,
    creatorFilter,
    setCreatorFilter,
    showWeekends,
    setShowWeekends,
    showMulti,
    setShowMulti,
    colorBy,
    setColorBy,
    weekStart,
    setWeekStart,
    visibleTasks,
    multiSpans,
    singleByDay,
    undated,
  };
}
