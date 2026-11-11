"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { toast as toastMessage } from "@/lib/ui-feedback";

import { ApiError } from "@/lib/api-client";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { taskSectionId } from "@/lib/task-section";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskRow, User } from "@/lib/data";
import type { CustomField, CustomValue } from "@/lib/custom-fields";
import { todayISO } from "@/lib/dates";
import {
  formatDay,
  monthWeeks,
  packWeek,
  parseDay,
  shiftDay,
  weekAround,
} from "@/lib/calendar";
import TaskCompletionToggle from "./task/TaskCompletionToggle";
import TaskAvatar from "./task/TaskAvatar";
import TaskMetaBadges from "./task/TaskMetaBadges";
import { dropTaskOnDate, moveTaskSpan, pixelsToDayDelta, resizeTaskEnd, resizeTaskStart } from "@/lib/task-dates";
import CalendarToolbar from "./calendar/CalendarToolbar";
import CalendarDayHeader from "./calendar/CalendarDayHeader";
import CalendarLegend from "./calendar/CalendarLegend";
import CalendarMultiDayBar from "./calendar/CalendarMultiDayBar";
import CalendarSingleTask from "./calendar/CalendarSingleTask";
import CalendarDayCell from "./calendar/CalendarDayCell";
import CalendarGrid from "./calendar/CalendarGrid";
import { useCalendarFilters, type CalendarFilter } from "@/lib/use-calendar-filters";

// Asana calendar metrics measured 2026-11-06 (read-only, 1920×839):
// compact weekend columns 44px, weekday columns share the rest; week header
// 70px, range bar 36px / 4px radius / 1px #eaeaea, day row 36px.
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS_ONLY = [1, 2, 3, 4, 5];
const MONTH_SINGLE_LIMIT = 3;
const UNSET_COLOR = "border-neutral-300 bg-neutral-100 text-neutral-600";
const BAR_COLORS = [
  "border-[#c7d8f5] bg-[#e8f0fe] text-[#1f3a6e]",
  "border-[#c9e7d2] bg-[#e6f6ec] text-[#1f5134]",
  "border-[#f3d9b1] bg-[#fdf2e2] text-[#6b4a1d]",
  "border-[#e6cdea] bg-[#f6e8f8] text-[#5b2a63]",
  "border-[#f1c9c9] bg-[#fdecec] text-[#6b2727]",
  "border-[#c9e3e7] bg-[#e8f6f8] text-[#1f4e56]",
];

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

export default function CalendarView({
  projectId,
  tasks,
  sections,
  users,
  customFields,
  customValues,
  projectStatusOptions,
  statusFieldName,
  statusFieldEnabled,
  viewerId,
  month,
  week,
  initial,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
}: {
  projectId: number;
  tasks: TaskRow[];
  sections: Section[];
  users: User[];
  customFields: CustomField[];
  customValues: Record<number, Record<number, CustomValue>>;
  projectStatusOptions: string[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
  viewerId: number | null;
  month: string; // YYYY-MM
  week: string | null; // YYYY-MM-DD anchor day, null = month mode
  initial: CalendarFilter;
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
}) {
  const weekMode = week !== null;
  const router = useRouter();
  const refresh = () => router.refresh();
  const today = todayISO();
  const selectFields = customFields.filter((f) => f.field_type === "select");
  const colorOptions = [
    { value: "none", label: "カラーなし" },
    { value: "default", label: "セクション" },
    ...(statusFieldEnabled ? [{ value: "status", label: statusFieldName }] : []),
    ...selectFields.map((f) => ({ value: `cf:${f.id}`, label: f.name })),
  ];
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const touchMove = useRef<{
    taskId: number;
    startX: number;
    startY: number;
    start: number;
    end: number;
    dayWidth: number;
    single: boolean;
    moved: boolean;
  } | null>(null);
  const calendarResize = useRef<{
    taskId: number;
    edge: "start" | "end";
    startX: number;
    dayWidth: number;
    start: number;
    end: number;
  } | null>(null);

  const {
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
  } = useCalendarFilters({
    projectId,
    tasks,
    customValues,
    statusFieldEnabled,
    initial,
    colorOptions,
    search,
  });

  useEffect(() => {
    if (addingDate) inputRef.current?.focus();
  }, [addingDate]);

  const statusOptions = [...new Set([...projectStatusOptions, ...tasks.map((t) => t.status).filter(Boolean)])];
  const weekdayOrder = weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : ALL_DAYS;
  const visibleDays = showWeekends
    ? ALL_DAYS
    : weekStart === 1
      ? [0, 1, 2, 3, 4]
      : WEEKDAYS_ONLY;
  const cols = !showWeekends
    ? "repeat(5, minmax(0, 1fr))"
    : weekStart === 1
      ? "repeat(5, minmax(0, 1fr)) 44px 44px"
      : "44px repeat(5, minmax(0, 1fr)) 44px";

  const colorKeyFor = (task: TaskRow): string => {
    if (colorBy === "default") {
      const sid = taskSectionId(task);
      if (sid === null || sid === undefined) return "";
      return sections.find((section) => section.id === sid)?.name ?? "";
    }
    if (statusFieldEnabled && colorBy === "status") return task.status ?? "";
    if (colorBy.startsWith("cf:")) {
      return customValues[task.id]?.[Number(colorBy.slice(3))]?.value_text ?? "";
    }
    return "";
  };

  const baseColorKeys =
    colorBy === "default"
      ? sections.map((section) => section.name)
      : statusFieldEnabled && colorBy === "status"
        ? projectStatusOptions
        : colorBy.startsWith("cf:")
          ? (selectFields.find((field) => `cf:${field.id}` === colorBy)?.options ?? [])
          : [];
  const observedColorKeys: string[] = [];
  for (const task of visibleTasks) {
    const key = colorKeyFor(task);
    if (key !== "" && !baseColorKeys.includes(key) && !observedColorKeys.includes(key)) {
      observedColorKeys.push(key);
    }
  }
  const colorKeys = [...baseColorKeys, ...observedColorKeys];

  const colorFor = (key: string): string => {
    if (key === "") return UNSET_COLOR;
    const idx = colorKeys.indexOf(key);
    if (idx >= 0) return BAR_COLORS[idx % BAR_COLORS.length];
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return BAR_COLORS[Math.abs(hash) % BAR_COLORS.length];
  };

  const anchor = weekMode ? week! : `${month}-01`;
  const [anchorY, anchorM] = anchor.slice(0, 7).split("-").map(Number);
  const weeks = (weekMode ? [weekAround(anchor, weekStart)] : monthWeeks(month, weekStart)).map((days) => ({
    days,
    lanes: packWeek(multiSpans, days[0], days[6], visibleDays),
  }));

  const filterQsParts: string[] = [];
  if (completedFilter) filterQsParts.push(`completed=${completedFilter}`);
  if (completedFilter === "open") filterQsParts.push("hide=1");
  if (assigneeFilter) filterQsParts.push(`assignee=${encodeURIComponent(assigneeFilter)}`);
  if (statusFilter) filterQsParts.push(`status=${encodeURIComponent(statusFilter)}`);
  if (dueFilter) filterQsParts.push(`due=${encodeURIComponent(dueFilter)}`);
  if (createdFilter) filterQsParts.push(`created=${encodeURIComponent(createdFilter)}`);
  if (updatedFilter) filterQsParts.push(`updated=${encodeURIComponent(updatedFilter)}`);
  if (completedOnFilter) filterQsParts.push(`completed_on=${encodeURIComponent(completedOnFilter)}`);
  if (creatorFilter) filterQsParts.push(`creator=${encodeURIComponent(creatorFilter)}`);
  for (const [fieldId, value] of Object.entries(customFilter)) {
    filterQsParts.push(`cf_${fieldId}=${encodeURIComponent(value)}`);
  }
  if (!showWeekends) filterQsParts.push("weekends=0");
  if (!showMulti) filterQsParts.push("multi=0");
  if (colorBy !== "none") filterQsParts.push(`color=${encodeURIComponent(colorBy)}`);
  if (weekStart === 1) filterQsParts.push("start=1");
  const filterQs = filterQsParts.map((p) => `&${p}`).join("");
  const href = (params: string) => `/projects/${projectId}?view=calendar${params}${filterQs}`;

  const prevHref = weekMode
    ? href(`&zoom=week&week=${shiftDay(week!, -7)}`)
    : href(`&month=${monthLabelShift(month, -1)}`);
  const nextHref = weekMode
    ? href(`&zoom=week&week=${shiftDay(week!, 7)}`)
    : href(`&month=${monthLabelShift(month, 1)}`);
  const todayHref = weekMode
    ? href(`&zoom=week&week=${today}`)
    : href(`&month=${today.slice(0, 7)}`);
  const weekHref = href(`&zoom=week&week=${weekMode ? week! : `${month}-01`}`);
  const monthHref = href(`&month=${anchor.slice(0, 7)}`);

  const openTask = (id: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set("task", String(id));
    router.push(`/projects/${projectId}?${q.toString()}`);
  };

  const patchTaskFields = async (task: TaskRow, fields: Record<string, unknown>) => {
    try {
      await patchTask(task.id, fields, task.updated_at);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      } else {
        toastMessage(`更新に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
      refresh();
      return false;
    }
    refresh();
    return true;
  };

  const toggleComplete = async (task: TaskRow) => {
    if (task.approval) {
      openTask(task.id);
      return;
    }
    await patchTaskFields(task, { completed: !task.completed, progress: task.completed ? task.progress : 100 });
  };

  const onDrop = async (e: React.DragEvent, date: string) => {
    e.preventDefault();
    const taskId = Number(e.dataTransfer.getData("text/atlas-task"));
    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const fields = dropTaskOnDate(task, date, showMulti);
    if (fields) await patchTaskFields(task, fields);
  };

  const multiDayWidthFromEvent = (event: React.PointerEvent) => {
    const grid = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-calendar-multi-grid]");
    const dayCells = [
      ...(grid?.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[data-calendar-day]") ?? []),
    ];
    return grid && dayCells.length > 0
      ? Math.max(...dayCells.map((cell) => cell.getBoundingClientRect().width))
      : null;
  };

  const multiBarDragStart = (task: TaskRow, event: React.DragEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-calendar-resize]")) {
      event.preventDefault();
      return;
    }
    dragging.current = true;
    event.dataTransfer.setData("text/atlas-task", String(task.id));
  };
  const multiBarDragEnd = () => {
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  };
  const multiBarClick = (task: TaskRow) => {
    if (dragging.current) return;
    openTask(task.id);
  };
  const multiBarKeyDown = (task: TaskRow, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Enter") openTask(task.id);
  };
  const multiBarPointerDown = (task: TaskRow, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if ((event.target as HTMLElement).closest("[data-calendar-resize]")) return;
    const start = parseDay(task.start_on ?? task.due_on ?? "");
    const end = parseDay(task.due_on ?? task.start_on ?? "");
    const dayWidth = multiDayWidthFromEvent(event);
    if (dayWidth === null || start === null || end === null) return;
    touchMove.current = {
      taskId: task.id,
      startX: event.clientX,
      startY: event.clientY,
      start,
      end,
      dayWidth,
      single: false,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const multiBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = touchMove.current;
    if (!session) return;
    if (Math.abs(event.clientX - session.startX) > 6 || Math.abs(event.clientY - session.startY) > 6) {
      session.moved = true;
      dragging.current = true;
    }
  };
  const multiBarPointerUp = (task: TaskRow, event: React.PointerEvent<HTMLDivElement>) => {
    const session = touchMove.current;
    touchMove.current = null;
    if (!session || !session.moved) return;
    const delta = pixelsToDayDelta(event.clientX - session.startX, session.dayWidth);
    if (delta !== 0) {
      const fields = moveTaskSpan(task, delta);
      if (fields) void patchTaskFields(task, fields);
    }
    setTimeout(() => {
      dragging.current = false;
    }, 30);
  };
  const multiBarPointerCancel = () => {
    touchMove.current = null;
    setTimeout(() => {
      dragging.current = false;
    }, 30);
  };
  const multiBarResizeDown = (
    task: TaskRow,
    edge: "start" | "end",
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    const start = parseDay(task.start_on ?? task.due_on ?? "");
    const end = parseDay(task.due_on ?? task.start_on ?? "");
    const dayWidth = multiDayWidthFromEvent(event);
    if (start === null || end === null || dayWidth === null) return;
    event.preventDefault();
    event.stopPropagation();
    calendarResize.current = {
      taskId: task.id,
      edge,
      startX: event.clientX,
      dayWidth,
      start,
      end,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const multiBarResizeUp = (
    task: TaskRow,
    edge: "start" | "end",
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    const session = calendarResize.current;
    calendarResize.current = null;
    if (!session) return;
    const delta = pixelsToDayDelta(event.clientX - session.startX, session.dayWidth);
    if (delta === 0) return;
    const fields = edge === "start" ? resizeTaskStart(task, delta) : resizeTaskEnd(task, delta);
    if (fields) void patchTaskFields(task, fields);
  };

  const singleBarDragStart = (task: TaskRow, event: React.DragEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.dataTransfer.setData("text/atlas-task", String(task.id));
  };
  const singleBarDragEnd = () => {
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  };
  const singleBarClick = (task: TaskRow) => {
    if (dragging.current) return;
    openTask(task.id);
  };
  const singleBarKeyDown = (task: TaskRow, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Enter") openTask(task.id);
  };
  const singleBarPointerDown = (task: TaskRow, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const day = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-calendar-day]");
    const start = parseDay(task.start_on ?? task.due_on ?? "");
    const end = parseDay(task.due_on ?? task.start_on ?? "");
    if (!day || start === null || end === null) return;
    touchMove.current = {
      taskId: task.id,
      startX: event.clientX,
      startY: event.clientY,
      start,
      end,
      dayWidth: day.getBoundingClientRect().width,
      single: true,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const singleBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = touchMove.current;
    if (!session) return;
    if (Math.abs(event.clientX - session.startX) > 6 || Math.abs(event.clientY - session.startY) > 6) {
      session.moved = true;
      dragging.current = true;
    }
  };
  const singleBarPointerUp = (task: TaskRow, event: React.PointerEvent<HTMLDivElement>) => {
    const session = touchMove.current;
    touchMove.current = null;
    if (!session || !session.moved) return;
    const delta = pixelsToDayDelta(event.clientX - session.startX, session.dayWidth);
    if (delta !== 0) {
      const fields = dropTaskOnDate(task, formatDay(session.end + delta), false);
      if (fields) void patchTaskFields(task, fields);
    }
    setTimeout(() => {
      dragging.current = false;
    }, 30);
  };
  const singleBarPointerCancel = () => {
    touchMove.current = null;
    setTimeout(() => {
      dragging.current = false;
    }, 30);
  };

  const startInlineAdd = (date: string) => {
    setAddingDate(date);
    setDraft("");
  };

  const submitInlineAdd = async (date: string) => {
    const name = draft.trim();
    if (!name) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        section_id: sections[0]?.id ?? null,
        name,
        due_on: date,
      }),
    });
    if (!res.ok) {
      toastMessage(`作成に失敗しました: ${res.status}`);
      return;
    }
    setDraft("");
    refresh();
  };

  const addToday = async () => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        section_id: sections[0]?.id ?? null,
        name: "新規タスク",
        due_on: today,
      }),
    });
    if (!res.ok) {
      toastMessage(`作成に失敗しました: ${res.status}`);
      return;
    }
    const created = await res.json();
    openTask(created.id);
  };

  const commit = (patch: Record<string, string | null>) => {
    const next: Record<string, string | null> = {
      completed: completedFilter,
      hide: completedFilter === "open" ? "1" : null,
      assignee: assigneeFilter,
      status: statusFilter,
      due: dueFilter,
      created: createdFilter,
      updated: updatedFilter,
      completed_on: completedOnFilter,
      creator: creatorFilter,
      weekends: showWeekends ? null : "0",
      multi: showMulti ? null : "0",
      color: colorBy === "none" ? null : colorBy,
      start: weekStart === 1 ? "1" : null,
    };
    const customNext = { ...customFilter };
    for (const [key, value] of Object.entries(patch)) {
      if (key.startsWith("cf_")) {
        const fieldId = key.slice(3);
        if (value) customNext[fieldId] = value;
        else delete customNext[fieldId];
      } else {
        next[key] = value;
      }
    }
    const q = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(next)) {
      if (value) q.set(key, value);
      else q.delete(key);
    }
    for (const key of Object.keys(customFilter)) q.delete(`cf_${key}`);
    for (const [fieldId, value] of Object.entries(customNext)) q.set(`cf_${fieldId}`, value);
    q.delete("task");
    router.replace(`/projects/${projectId}?${q.toString()}`, { scroll: false });
  };

  const setCompleted = (value: "open" | "done" | "") => {
    const next = completedFilter === value ? "" : value;
    setCompletedFilter(next);
    commit({ completed: next || null, hide: next === "open" ? "1" : null });
  };

  const setAssignee = (value: string) => {
    setAssigneeFilter(value);
    commit({ assignee: value || null });
  };

  const setStatus = (value: string) => {
    setStatusFilter(value);
    commit({ status: value || null });
  };

  const setDue = (value: string) => {
    setDueFilter(value);
    commit({ due: value || null });
  };

  const setCreated = (value: string) => {
    setCreatedFilter(value);
    commit({ created: value || null });
  };

  const setUpdated = (value: string) => {
    setUpdatedFilter(value);
    commit({ updated: value || null });
  };

  const setCompletedOn = (value: string) => {
    setCompletedOnFilter(value);
    commit({ completed_on: value || null });
  };

  const setCreator = (value: string) => {
    setCreatorFilter(value);
    commit({ creator: value || null });
  };

  const setCustomFilterValue = (fieldId: number, value: string) => {
    setCustomFilter((prev) => {
      const next = { ...prev };
      if (value) next[String(fieldId)] = value;
      else delete next[String(fieldId)];
      return next;
    });
    commit({ [`cf_${fieldId}`]: value || null });
  };

  const clearFilters = () => {
    setCompletedFilter("");
    setAssigneeFilter("");
    setStatusFilter("");
    setCustomFilter({});
    setDueFilter("");
    setCreatedFilter("");
    setUpdatedFilter("");
    setCompletedOnFilter("");
    setCreatorFilter("");
    const patch: Record<string, string | null> = {
      completed: null,
      hide: null,
      assignee: null,
      status: null,
      due: null,
      created: null,
      updated: null,
      completed_on: null,
      creator: null,
    };
    for (const f of selectFields) patch[`cf_${f.id}`] = null;
    commit(patch);
  };

  const setWeekends = (value: boolean) => {
    setShowWeekends(value);
    commit({ weekends: value ? null : "0" });
  };

  const setMulti = (value: boolean) => {
    setShowMulti(value);
    commit({ multi: value ? null : "0" });
  };

  const setColor = (value: string) => {
    setColorBy(value);
    commit({ color: value === "none" ? null : value });
  };

  const setWeekStartOn = (value: 0 | 1) => {
    setWeekStart(value);
    commit({ start: value === 1 ? "1" : null });
  };

  const activeFilters =
    (completedFilter ? 1 : 0) +
    (assigneeFilter ? 1 : 0) +
    (statusFieldEnabled && statusFilter ? 1 : 0) +
    (dueFilter ? 1 : 0) +
    (createdFilter ? 1 : 0) +
    (updatedFilter ? 1 : 0) +
    (completedOnFilter ? 1 : 0) +
    (creatorFilter ? 1 : 0) +
    Object.keys(customFilter).length;
  const title = monthLabel(`${anchorY}-${String(anchorM).padStart(2, "0")}`);

  const completion = (task: TaskRow, size = "h-4 w-4") => (
    <TaskCompletionToggle completed={task.completed} milestone={task.is_milestone} onToggle={() => toggleComplete(task)} size={size}
      {...(task.approval ? { "aria-label": "承認の詳細を開く", title: "承認の詳細を開く" } : {})} />
  );

  const taskFace = (task: TaskRow, bar: boolean) => {
    const colored = colorBy !== "none";
    const color = colored ? colorFor(colorKeyFor(task)) : "";
    const base = bar
      ? `flex h-9 cursor-pointer items-center gap-1.5 overflow-hidden border px-1.5 text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:brightness-[0.98] ${
          colored ? color : "border-neutral-200 bg-white text-neutral-900"
        }`
      : `flex h-9 cursor-pointer items-center gap-1.5 overflow-hidden rounded px-1 text-[13px] ${
          colored ? `border ${color}` : "text-neutral-900 hover:bg-neutral-100"
        }`;
    return `${base} ${task.completed ? "opacity-70" : ""}`;
  };

  const taskAvatars = (task: TaskRow) => (
    <TaskAvatar name={task.assignee_name} />
  );

  const taskMeta = (task: TaskRow) => (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-neutral-400">
      <TaskMetaBadges
        subtaskCount={task.subtask_count}
        commentCount={task.comment_count}
        iconClassName="h-3 w-3"
      />
    </span>
  );

  return (
    <div
      className="flex min-h-[560px] flex-col px-4 pb-2 text-sm md:h-[calc(100vh-200px)]"
      data-calendar-view
      data-calendar-completed={completedFilter}
      data-calendar-assignee={assigneeFilter}
      data-calendar-status={statusFilter}
      data-calendar-due={dueFilter}
      data-calendar-created={createdFilter}
      data-calendar-updated={updatedFilter}
      data-calendar-completed-on={completedOnFilter}
      data-calendar-creator={creatorFilter}
    >
      <CalendarToolbar
        addToday={addToday}
        prevHref={prevHref}
        todayHref={todayHref}
        nextHref={nextHref}
        weekMode={weekMode}
        title={title}
        undated={undated}
        dragging={dragging}
        openTask={openTask}
        weekHref={weekHref}
        monthHref={monthHref}
        activeFilters={activeFilters}
        clearFilters={clearFilters}
        completedFilter={completedFilter}
        setCompleted={setCompleted}
        viewerId={viewerId}
        assigneeFilter={assigneeFilter}
        setAssignee={setAssignee}
        users={users}
        statusFieldEnabled={statusFieldEnabled}
        statusFieldName={statusFieldName}
        statusOptions={statusOptions}
        statusFilter={statusFilter}
        setStatus={setStatus}
        dueFilter={dueFilter}
        setDue={setDue}
        createdFilter={createdFilter}
        setCreated={setCreated}
        updatedFilter={updatedFilter}
        setUpdated={setUpdated}
        completedOnFilter={completedOnFilter}
        setCompletedOn={setCompletedOn}
        creatorFilter={creatorFilter}
        setCreator={setCreator}
        selectFields={selectFields}
        customFilter={customFilter}
        setCustomFilterValue={setCustomFilterValue}
        colorBy={colorBy}
        setColor={setColor}
        colorOptions={colorOptions}
        showWeekends={showWeekends}
        setWeekends={setWeekends}
        showMulti={showMulti}
        setMulti={setMulti}
        weekStart={weekStart}
        setWeekStartOn={setWeekStartOn}
        searchOpen={searchOpen}
        search={search}
        setSearch={setSearch}
        setSearchOpen={setSearchOpen}
        viewName={viewName}
        viewIcon={viewIcon}
        viewTabId={viewTabId}
        canEdit={canEdit}
      />

      {colorBy !== "none" && <CalendarLegend colorKeys={colorKeys} colorFor={colorFor} />}

      <CalendarGrid
        weekMode={weekMode}
        cols={cols}
        weekdayOrder={weekdayOrder}
        visibleDays={visibleDays}
      >
          {weeks.map(({ days, lanes }) => {
            const visibleWeekDays = days.filter((_, i) => visibleDays.includes(i));
            return (
              <div key={days[0]} className={weekMode ? "flex min-h-0 flex-1 flex-col" : ""}>
                <div className="grid" style={{ gridTemplateColumns: cols }}>
                  {visibleWeekDays.map((day) => (
                    <CalendarDayHeader
                      key={day}
                      day={day}
                      weekView={weekMode}
                      month={month}
                      today={today}
                      onAdd={startInlineAdd}
                    />
                  ))}
                </div>
                {lanes.length > 0 && (
                  <div
                    className="relative border-b border-neutral-200"
                    style={{ minHeight: lanes.length * 36 + 8 }}
                  >
                    <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: cols }}>
                      {visibleWeekDays.map((day) => (
                        <div key={day} className="border-r border-neutral-200" />
                      ))}
                    </div>
                    <div
                      data-calendar-multi-grid
                      className="relative grid py-1"
                      style={{
                        gridTemplateColumns: cols,
                        gridTemplateRows: `repeat(${lanes.length}, 36px)`,
                      }}
                    >
                      {lanes.flatMap((lane, laneIdx) =>
                        lane.map((bar) => {
                          const t = bar.item.task;
                          return (
                            <CalendarMultiDayBar
                              key={`${days[0]}-${t.id}`}
                              task={t}
                              gridRow={laneIdx}
                              colStart={bar.colStart}
                              colEnd={bar.colEnd}
                              continuesLeft={bar.continuesLeft}
                              continuesRight={bar.continuesRight}
                              colorKey={colorKeyFor(t)}
                              taskFaceClass={taskFace(t, true)}
                              completion={completion(t)}
                              avatars={taskAvatars(t)}
                              meta={taskMeta(t)}
                              onDragStart={(event) => multiBarDragStart(t, event)}
                              onDragEnd={multiBarDragEnd}
                              onClick={() => multiBarClick(t)}
                              onKeyDown={(event) => multiBarKeyDown(t, event)}
                              onPointerDown={(event) => multiBarPointerDown(t, event)}
                              onPointerMove={multiBarPointerMove}
                              onPointerUp={(event) => multiBarPointerUp(t, event)}
                              onPointerCancel={multiBarPointerCancel}
                              onResizeDown={(edge, event) => multiBarResizeDown(t, edge, event)}
                              onResizeUp={(edge, event) => multiBarResizeUp(t, edge, event)}
                            />
                          );
                        }),
                      )}
                    </div>
                  </div>
                )}
                <div className={`grid ${weekMode ? "min-h-0 flex-1" : ""}`} style={{ gridTemplateColumns: cols }}>
                  {visibleWeekDays.map((day) => {
                    const iso = formatDay(day);
                    const dayTasks = singleByDay.get(iso) ?? [];
                    const expanded = expandedDays.has(iso);
                    const shownDayTasks = weekMode || expanded ? dayTasks : dayTasks.slice(0, MONTH_SINGLE_LIMIT);
                    const hiddenDayTasks = dayTasks.length - shownDayTasks.length;
                    const adding = addingDate === iso;
                    const dt = new Date(day * 86_400_000);
                    const compact = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
                    return (
                      <CalendarDayCell
                        key={iso}
                        iso={iso}
                        taskCount={dayTasks.length}
                        shownTasks={shownDayTasks}
                        hiddenCount={hiddenDayTasks}
                        expanded={expanded}
                        weekMode={weekMode}
                        adding={adding}
                        draft={draft}
                        compact={compact}
                        inputRef={inputRef}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => onDrop(event, iso)}
                        onExpand={() => setExpandedDays((prev) => new Set(prev).add(iso))}
                        onCollapse={() =>
                          setExpandedDays((prev) => {
                            const next = new Set(prev);
                            next.delete(iso);
                            return next;
                          })
                        }
                        onStartAdd={() => startInlineAdd(iso)}
                        onDraftChange={setDraft}
                        onDraftKeyDown={(event) => {
                          if (isImeComposing(event)) return;
                          if (event.key === "Enter") submitInlineAdd(iso);
                          if (event.key === "Escape") {
                            setAddingDate(null);
                            setDraft("");
                          }
                        }}
                        onDraftBlur={() => {
                          if (!draft.trim()) setAddingDate(null);
                        }}
                        renderTask={(task) => (
                          <CalendarSingleTask
                            key={task.id}
                            task={task}
                            colorKey={colorKeyFor(task)}
                            taskFaceClass={taskFace(task, false)}
                            completion={completion(task)}
                            avatars={taskAvatars(task)}
                            meta={taskMeta(task)}
                            onDragStart={(event) => singleBarDragStart(task, event)}
                            onDragEnd={singleBarDragEnd}
                            onClick={() => singleBarClick(task)}
                            onKeyDown={(event) => singleBarKeyDown(task, event)}
                            onPointerDown={(event) => singleBarPointerDown(task, event)}
                            onPointerMove={singleBarPointerMove}
                            onPointerUp={(event) => singleBarPointerUp(task, event)}
                            onPointerCancel={singleBarPointerCancel}
                          />
                        )}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
      </CalendarGrid>
    </div>
  );
}

function monthLabelShift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
