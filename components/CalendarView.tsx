"use client";

import Link from "next/link";
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
  taskSpan,
  weekAround,
  type CalendarSpan,
} from "@/lib/calendar";

// Asana calendar metrics measured 2026-11-06 (read-only, 1920×839):
// compact weekend columns 44px, weekday columns share the rest; week header
// 70px, range bar 36px / 4px radius / 1px #eaeaea, day row 36px.
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS_ONLY = [1, 2, 3, 4, 5];
const AVATAR_COLORS = ["bg-violet-400", "bg-amber-400", "bg-emerald-500", "bg-sky-500", "bg-rose-400"];
const BAR_COLORS = [
  "border-[#c7d8f5] bg-[#e8f0fe] text-[#1f3a6e]",
  "border-[#c9e7d2] bg-[#e6f6ec] text-[#1f5134]",
  "border-[#f3d9b1] bg-[#fdf2e2] text-[#6b4a1d]",
  "border-[#e6cdea] bg-[#f6e8f8] text-[#5b2a63]",
  "border-[#f1c9c9] bg-[#fdecec] text-[#6b2727]",
  "border-[#c9e3e7] bg-[#e8f6f8] text-[#1f4e56]",
];

type DatedTask = CalendarSpan & { task: TaskRow };
type CalendarFilter = {
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

function avatarColor(name: string | null): string {
  const code = name ? name.charCodeAt(0) : 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

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
  viewerId,
  month,
  week,
  initial,
}: {
  projectId: number;
  tasks: TaskRow[];
  sections: Section[];
  users: User[];
  customFields: CustomField[];
  customValues: Record<number, Record<number, CustomValue>>;
  projectStatusOptions: string[];
  viewerId: number | null;
  month: string; // YYYY-MM
  week: string | null; // YYYY-MM-DD anchor day, null = month mode
  initial: CalendarFilter;
}) {
  const weekMode = week !== null;
  const router = useRouter();
  const refresh = () => router.refresh();
  const today = todayISO();
  const selectFields = customFields.filter((f) => f.field_type === "select");
  const colorOptions = [
    { value: "none", label: "カラーなし" },
    { value: "default", label: "Asana デフォルト" },
    { value: "status", label: "Status" },
    ...selectFields.map((f) => ({ value: `cf:${f.id}`, label: f.name })),
  ];
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
    colorOptions.some((o) => o.value === initial.color) ? initial.color : "none",
  );
  const [weekStart, setWeekStart] = useState<0 | 1>(initial.weekStart);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const persistKey = `atlas.calendar.v1.${projectId}`;

  useEffect(() => {
    const keys = [
      "completed",
      "hide",
      "assignee",
      "status",
      "due",
      "created",
      "updated",
      "completed_on",
      "creator",
      "weekends",
      "multi",
      "color",
      "start",
    ];
    const params = new URLSearchParams(window.location.search);
    const explicit =
      keys.some((key) => params.has(key)) || [...params.keys()].some((key) => key.startsWith("cf_"));
    if (!explicit) {
      try {
        const saved = JSON.parse(window.localStorage.getItem(persistKey) ?? "null") as
          | Record<string, unknown>
          | null;
        /* eslint-disable react-hooks/set-state-in-effect */
        if (saved) {
          if (saved.completed === "open" || saved.completed === "done" || saved.completed === "") {
            setCompletedFilter(saved.completed);
          }
          if (typeof saved.assignee === "string") setAssigneeFilter(saved.assignee);
          if (typeof saved.status === "string") setStatusFilter(saved.status);
          if (saved.custom && typeof saved.custom === "object") {
            setCustomFilter(saved.custom as Record<string, string>);
          }
          if (typeof saved.due === "string") setDueFilter(saved.due);
          if (typeof saved.created === "string") setCreatedFilter(saved.created);
          if (typeof saved.updated === "string") setUpdatedFilter(saved.updated);
          if (typeof saved.completedOn === "string") setCompletedOnFilter(saved.completedOn);
          if (typeof saved.creator === "string") setCreatorFilter(saved.creator);
          if (typeof saved.weekends === "boolean") setShowWeekends(saved.weekends);
          if (typeof saved.multi === "boolean") setShowMulti(saved.multi);
          if (typeof saved.color === "string") setColorBy(saved.color);
          if (saved.weekStart === 0 || saved.weekStart === 1) setWeekStart(saved.weekStart);
        }
        setHydrated(true);
        /* eslint-enable react-hooks/set-state-in-effect */
      } catch {
        setHydrated(true);
      }
    } else {
      setHydrated(true);
    }
  }, [persistKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        persistKey,
        JSON.stringify({
          completed: completedFilter,
          assignee: assigneeFilter,
          status: statusFilter,
          custom: customFilter,
          due: dueFilter,
          created: createdFilter,
          updated: updatedFilter,
          completedOn: completedOnFilter,
          creator: creatorFilter,
          weekends: showWeekends,
          multi: showMulti,
          color: colorBy,
          weekStart,
        }),
      );
    } catch {
      // storage can be unavailable in private modes
    }
  }, [
    hydrated,
    persistKey,
    completedFilter,
    assigneeFilter,
    statusFilter,
    customFilter,
    dueFilter,
    createdFilter,
    updatedFilter,
    completedOnFilter,
    creatorFilter,
    showWeekends,
    showMulti,
    colorBy,
    weekStart,
  ]);

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

  const needle = search.trim().toLowerCase();
  const todayDay = parseDay(today);
  const withinDays = (iso: string | null | undefined, days: number) => {
    if (!iso) return false;
    const day = parseDay(iso.slice(0, 10));
    return day >= todayDay - (days - 1) && day <= todayDay;
  };
  const visibleTasks = tasks.filter((t) => {
    if (completedFilter === "open" && t.completed) return false;
    if (completedFilter === "done" && !t.completed) return false;
    if (assigneeFilter === "none" && t.assignee_id !== null) return false;
    if (assigneeFilter && assigneeFilter !== "none" && String(t.assignee_id ?? "") !== assigneeFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (creatorFilter === "none" && t.created_by !== null) return false;
    if (creatorFilter && creatorFilter !== "none" && String(t.created_by ?? "") !== creatorFilter) return false;
    for (const [fieldId, value] of Object.entries(customFilter)) {
      if (customValues[t.id]?.[Number(fieldId)]?.value_text !== value) return false;
    }
    if (dueFilter) {
      const due = t.due_on ? parseDay(t.due_on) : null;
      if (dueFilter === "none" && due !== null) return false;
      if (dueFilter === "overdue" && (t.completed || due === null || due >= todayDay)) return false;
      if (dueFilter === "today" && due !== todayDay) return false;
      if (dueFilter === "week" && (due === null || due < todayDay || due > todayDay + 6)) return false;
      if (dueFilter === "nextweek" && (due === null || due < todayDay + 7 || due > todayDay + 13)) return false;
      if (dueFilter === "month" && (due === null || due < todayDay || due > todayDay + 29)) return false;
    }
    if (createdFilter && !withinDays(t.created_at, createdFilter === "today" ? 1 : Number(createdFilter))) {
      return false;
    }
    if (updatedFilter && !withinDays(t.updated_at, updatedFilter === "today" ? 1 : Number(updatedFilter))) {
      return false;
    }
    if (
      completedOnFilter &&
      (!t.completed ||
        !t.completed_at ||
        !withinDays(t.completed_at, completedOnFilter === "today" ? 1 : Number(completedOnFilter)))
    ) {
      return false;
    }
    if (needle && !t.name.toLowerCase().includes(needle)) return false;
    return true;
  });

  const multiSpans: DatedTask[] = [];
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

  const patchTask = async (task: TaskRow, fields: Record<string, unknown>) => {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, expected_updated_at: task.updated_at }),
    });
    if (res.status === 409) {
      alert("他のユーザーが先に更新しました。最新を表示します。");
      refresh();
      return false;
    }
    if (!res.ok) {
      alert(`更新に失敗しました: ${res.status}`);
      return false;
    }
    refresh();
    return true;
  };

  const toggleComplete = async (task: TaskRow) => {
    await patchTask(task, { completed: !task.completed, progress: task.completed ? task.progress : 100 });
  };

  const onDrop = async (e: React.DragEvent, date: string) => {
    e.preventDefault();
    const taskId = Number(e.dataTransfer.getData("text/atlas-task"));
    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const span = taskSpan(task.start_on, task.due_on);
    const target = parseDay(date);
    let fields: Record<string, unknown>;
    if (span && span.end > span.start && showMulti) {
      const duration = span.end - span.start;
      fields = { start_on: formatDay(target - duration), due_on: date };
    } else if (task.start_on) {
      fields = { start_on: date, due_on: date };
    } else {
      fields = { due_on: date };
    }
    await patchTask(task, fields);
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
      alert(`作成に失敗しました: ${res.status}`);
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
      alert(`作成に失敗しました: ${res.status}`);
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
    (statusFilter ? 1 : 0) +
    (dueFilter ? 1 : 0) +
    (createdFilter ? 1 : 0) +
    (updatedFilter ? 1 : 0) +
    (completedOnFilter ? 1 : 0) +
    (creatorFilter ? 1 : 0) +
    Object.keys(customFilter).length;
  const optionsActive = !showWeekends || !showMulti || colorBy !== "none" || weekStart === 1;
  const title = monthLabel(`${anchorY}-${String(anchorM).padStart(2, "0")}`);

  const colorClass = (task: TaskRow): string => {
    let key = "";
    if (colorBy === "default") key = `section:${task.eff_section_id ?? task.section_id ?? ""}`;
    else if (colorBy === "status") key = task.status;
    else if (colorBy.startsWith("cf:")) {
      key = customValues[task.id]?.[Number(colorBy.slice(3))]?.value_text ?? "";
    }
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return BAR_COLORS[Math.abs(hash) % BAR_COLORS.length];
  };

  const dayHeader = (day: number, weekView: boolean) => {
    const iso = formatDay(day);
    const dt = new Date(day * 86_400_000);
    const idx = dt.getUTCDay();
    const compact = idx === 0 || idx === 6;
    const sameMonth = iso.slice(0, 7) === month;
    const isToday = iso === today;
    return (
      <div
        key={iso}
        data-day-header={iso}
        className={`group/day overflow-hidden border-r border-b border-neutral-200 bg-white ${
          weekView ? "flex h-[70px] flex-col px-2 py-2" : "flex h-7 items-center px-1.5"
        } ${compact ? "items-center" : ""}`}
      >
        {weekView ? (
          <>
            <div className={`flex items-center gap-1 ${compact ? "text-[10px]" : "text-xs"}`}>
              <span className={compact ? "text-neutral-400" : "text-neutral-500"}>{WEEKDAYS[idx]}</span>
              <span
                className={`inline-flex items-center justify-center font-normal ${
                  isToday
                    ? "h-7 min-w-7 rounded-lg bg-[#4075cf] px-1 text-[14px] text-white"
                    : `text-[14px] ${sameMonth ? "text-neutral-900" : "text-neutral-400"}`
                }`}
              >
                {dt.getUTCDate()}
              </span>
            </div>
            {!compact && (
              <button
                type="button"
                onClick={() => startInlineAdd(iso)}
                className="mt-0.5 flex h-5 w-fit items-center rounded px-1 text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              >
                ＋ タスクを追加
              </button>
            )}
          </>
        ) : (
          <span
            className={`inline-flex items-center justify-center text-xs ${
              isToday
                ? "h-6 min-w-6 rounded-md bg-[#4075cf] px-1 font-medium text-white"
                : sameMonth
                  ? "text-neutral-600"
                  : "text-neutral-400"
            }`}
          >
            {sameMonth || compact
              ? dt.getUTCDate()
              : `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日`}
          </span>
        )}
      </div>
    );
  };

  const completion = (task: TaskRow, size = "h-4 w-4") => (
    <button
      type="button"
      aria-label={task.completed ? "未完了に戻す" : "完了にする"}
      onClick={(e) => {
        e.stopPropagation();
        toggleComplete(task);
      }}
      className={`${size} flex shrink-0 items-center justify-center rounded-full border ${
        task.completed
          ? "border-green-600 bg-green-600 text-white"
          : "border-neutral-400 bg-white/70 text-transparent hover:border-green-600 hover:text-green-600"
      }`}
    >
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2.5 6.2 5 8.6l4.5-5" />
      </svg>
    </button>
  );

  const taskFace = (task: TaskRow, bar: boolean) => {
    const colored = colorBy !== "none";
    const color = colored ? colorClass(task) : "";
    const base = bar
      ? `flex h-9 cursor-pointer items-center gap-1.5 overflow-hidden border px-1.5 text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:brightness-[0.98] ${
          colored ? color : "border-neutral-200 bg-white text-neutral-900"
        }`
      : `flex h-9 cursor-pointer items-center gap-1.5 overflow-hidden rounded px-1 text-[13px] ${
          colored ? `border ${color}` : "text-neutral-900 hover:bg-neutral-100"
        }`;
    return `${base} ${task.completed ? "opacity-70" : ""}`;
  };

  const taskAvatars = (task: TaskRow) =>
    task.assignee_name ? (
      <span
        title={task.assignee_name}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(task.assignee_name)}`}
      >
        {task.assignee_name.slice(0, 1)}
      </span>
    ) : null;

  const taskMeta = (task: TaskRow) => (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-neutral-400">
      {task.subtask_count > 0 && (
        <span className="flex items-center gap-0.5" title="サブタスク">
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M4 3v4.5a2 2 0 0 0 2 2h6" />
            <path d="M9.5 7.5 12 9.5 9.5 11.5" />
          </svg>
          {task.subtask_count}
        </span>
      )}
      {task.comment_count > 0 && (
        <span className="flex items-center gap-0.5" title="コメント">
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
          </svg>
          {task.comment_count}
        </span>
      )}
    </span>
  );

  return (
    <div className="flex min-h-[560px] flex-col px-4 pb-2 text-sm md:h-[calc(100vh-200px)]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 py-2">
        <button
          type="button"
          onClick={addToday}
          data-calendar-add
          className="mr-1 flex h-7 items-center rounded-md border border-[#e1e1e1] bg-white px-2.5 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50"
        >
          ＋ タスクを追加
        </button>
        <Link
          href={prevHref}
          aria-label={weekMode ? "前週" : "前月"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100"
        >
          ‹
        </Link>
        <Link href={todayHref} className="flex h-7 items-center rounded-md px-2 text-[13px] text-neutral-700 hover:bg-neutral-100">
          今日
        </Link>
        <Link
          href={nextHref}
          aria-label={weekMode ? "来週" : "来月"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100"
        >
          ›
        </Link>
        <span className="ml-1 text-[15px] font-medium text-neutral-900">{title}</span>

        <span className="ml-auto" />
        <details className="relative">
          <summary
            data-calendar-undated
            className={`flex h-7 cursor-pointer list-none items-center rounded-md px-2 text-[13px] hover:bg-neutral-100 [&::-webkit-details-marker]:hidden ${
              undated.length ? "text-neutral-700" : "text-neutral-400"
            }`}
          >
            日付なしのタスク ({undated.length} 件)
          </summary>
          <div className="absolute right-0 z-30 mt-1 max-h-64 w-72 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
            {undated.length === 0 ? (
              <div className="px-2 py-2 text-xs text-neutral-400">日付なしのタスクはありません</div>
            ) : (
              undated.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    dragging.current = true;
                    e.dataTransfer.setData("text/atlas-task", String(t.id));
                  }}
                  onDragEnd={() => {
                    setTimeout(() => {
                      dragging.current = false;
                    }, 0);
                  }}
                  onClick={() => {
                    if (dragging.current) return;
                    openTask(t.id);
                  }}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
                  title="日付を設定するにはカレンダーへドラッグ"
                >
                  {t.name}
                </button>
              ))
            )}
          </div>
        </details>
        <details className="relative">
          <summary
            data-calendar-zoom
            className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[13px] text-neutral-700 hover:bg-neutral-100 [&::-webkit-details-marker]:hidden"
          >
            {weekMode ? "週" : "月"}
            <span className="text-[10px] text-neutral-400">▾</span>
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-40 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
            <Link href={weekHref} className="flex h-9 items-center gap-2 rounded px-2 text-[13px] hover:bg-neutral-100">
              <span className="w-3 text-neutral-700">{weekMode ? "✓" : ""}</span>週
            </Link>
            <Link href={monthHref} className="flex h-9 items-center gap-2 rounded px-2 text-[13px] hover:bg-neutral-100">
              <span className="w-3 text-neutral-700">{!weekMode ? "✓" : ""}</span>月
            </Link>
          </div>
        </details>
        <details className="relative">
          <summary
            data-calendar-filter
            className={`flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[13px] hover:bg-neutral-100 [&::-webkit-details-marker]:hidden ${
              activeFilters ? "bg-[#eff4fd] font-medium text-[#2c60b8]" : "text-neutral-700"
            }`}
          >
            フィルター
            {activeFilters > 0 && <span className="text-[11px]">{activeFilters}</span>}
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-[min(420px,calc(100vw-2rem))] rounded-lg border border-neutral-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
              <span className="text-[13px] font-medium">フィルター</span>
              <button
                type="button"
                data-calendar-clear
                onClick={clearFilters}
                className="text-xs text-[#2c60b8] hover:underline"
              >
                クリア
              </button>
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-3">
              <div className="text-[11px] font-medium text-neutral-500">クイックフィルター</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  data-calendar-quick-completed="open"
                  onClick={() => setCompleted("open")}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    completedFilter === "open"
                      ? "border-[#b8ccef] bg-[#eff4fd] text-[#2c60b8]"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  未完了タスク
                </button>
                <button
                  type="button"
                  data-calendar-quick-completed="done"
                  onClick={() => setCompleted("done")}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    completedFilter === "done"
                      ? "border-[#b8ccef] bg-[#eff4fd] text-[#2c60b8]"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  完了したタスク
                </button>
                {viewerId !== null && (
                  <button
                    type="button"
                    data-calendar-quick-mine
                    onClick={() => setAssignee(assigneeFilter === String(viewerId) ? "" : String(viewerId))}
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      assigneeFilter === String(viewerId)
                        ? "border-[#b8ccef] bg-[#eff4fd] text-[#2c60b8]"
                        : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    自分のタスクのみ
                  </button>
                )}
              </div>
              <div className="mt-3 border-t border-neutral-100 pt-2">
                <div className="text-[11px] font-medium text-neutral-500">フィルターを追加</div>
                <label className="mt-1 block text-xs text-neutral-500">
                  担当者
                  <select
                    data-calendar-filter-assignee
                    value={assigneeFilter}
                    onChange={(e) => setAssignee(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="none">未割当</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  Status
                  <select
                    data-calendar-filter-status
                    value={statusFilter}
                    onChange={(e) => setStatus(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  期日
                  <select
                    data-calendar-filter-due
                    value={dueFilter}
                    onChange={(e) => setDue(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="overdue">期限切れ</option>
                    <option value="today">今日</option>
                    <option value="week">今週</option>
                    <option value="nextweek">来週</option>
                    <option value="month">来月まで</option>
                    <option value="none">日付なし</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  作成日
                  <select
                    data-calendar-filter-created
                    value={createdFilter}
                    onChange={(e) => setCreated(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="today">今日</option>
                    <option value="7">過去7日</option>
                    <option value="30">過去30日</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  最終変更日
                  <select
                    data-calendar-filter-updated
                    value={updatedFilter}
                    onChange={(e) => setUpdated(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="today">今日</option>
                    <option value="7">過去7日</option>
                    <option value="30">過去30日</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  完了日
                  <select
                    data-calendar-filter-completed-on
                    value={completedOnFilter}
                    onChange={(e) => setCompletedOn(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="today">今日</option>
                    <option value="7">過去7日</option>
                    <option value="30">過去30日</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-neutral-500">
                  作成したユーザー
                  <select
                    data-calendar-filter-creator
                    value={creatorFilter}
                    onChange={(e) => setCreator(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                  >
                    <option value="">すべて</option>
                    <option value="none">未設定</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectFields.map((field) => (
                  <label key={field.id} className="mt-2 block text-xs text-neutral-500">
                    {field.name}
                    <select
                      data-calendar-filter-field={field.id}
                      value={customFilter[String(field.id)] ?? ""}
                      onChange={(e) => setCustomFilterValue(field.id, e.target.value)}
                      className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
                    >
                      <option value="">すべて</option>
                      {customFilter[String(field.id)] &&
                        !field.options.includes(customFilter[String(field.id)]) && (
                          <option value={customFilter[String(field.id)]}>{customFilter[String(field.id)]}</option>
                        )}
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </details>
        <details className="relative">
          <summary
            data-calendar-options
            className={`flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[13px] hover:bg-neutral-100 [&::-webkit-details-marker]:hidden ${
              optionsActive ? "bg-[#eff4fd] font-medium text-[#2c60b8]" : "text-neutral-700"
            }`}
          >
            オプション
            <span className="text-[10px] text-neutral-400">▾</span>
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
            <div className="text-[11px] font-medium text-neutral-500">レイアウトオプション</div>
            <label className="mt-2 block text-xs text-neutral-500">
              タスクのカラー
              <select
                data-calendar-color
                value={colorBy}
                onChange={(e) => setColor(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
              >
                {colorOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                data-calendar-weekends
                checked={showWeekends}
                onChange={(e) => setWeekends(e.target.checked)}
              />
              週末を表示
            </label>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                data-calendar-multi
                checked={showMulti}
                onChange={(e) => setMulti(e.target.checked)}
              />
              複数日にわたるタスクを表示
            </label>
            <label className="mt-3 block text-xs text-neutral-500">
              週の始まり
              <select
                data-calendar-week-start
                value={weekStart}
                onChange={(e) => setWeekStartOn(e.target.value === "1" ? 1 : 0)}
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[13px] text-neutral-800"
              >
                <option value={0}>日曜日</option>
                <option value={1}>月曜日</option>
              </select>
            </label>
          </div>
        </details>
        {searchOpen && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="このビュー内で検索"
            aria-label="このビュー内で検索"
            autoFocus
            className="h-7 w-44 rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#4075cf]"
          />
        )}
        <button
          type="button"
          onClick={() => {
            if (searchOpen) setSearch("");
            setSearchOpen((v) => !v);
          }}
          data-calendar-search
          aria-label="このビューで検索"
          title="このビュー内で検索"
          className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-100 ${
            searchOpen ? "bg-[#eff4fd] text-[#2c60b8]" : "text-neutral-500"
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="6.8" cy="6.8" r="4.3" />
            <path d="m10.1 10.1 3 3" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-b-md border-l border-t border-neutral-200">
        <div className="flex min-h-full min-w-[720px] flex-col">
          {!weekMode && (
            <div
              className="sticky top-0 z-20 grid border-b border-neutral-200 bg-neutral-50"
              style={{ gridTemplateColumns: cols }}
            >
              {weekdayOrder.map((weekday, offset) =>
                visibleDays.includes(offset) ? (
                  <div
                    key={weekday}
                    className={`flex h-6 items-center border-r border-neutral-200 px-2 text-[11px] font-medium text-neutral-500 ${
                      weekday === 0 || weekday === 6 ? "justify-center px-0" : ""
                    }`}
                  >
                    {weekday === 0 || weekday === 6 ? "" : WEEKDAYS[weekday]}
                  </div>
                ) : null,
              )}
            </div>
          )}
          {weeks.map(({ days, lanes }) => {
            const visibleWeekDays = days.filter((_, i) => visibleDays.includes(i));
            return (
              <div key={days[0]} className={weekMode ? "flex min-h-0 flex-1 flex-col" : ""}>
                <div className="grid" style={{ gridTemplateColumns: cols }}>
                  {visibleWeekDays.map((day) => dayHeader(day, weekMode))}
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
                      className="relative grid py-1"
                      style={{
                        gridTemplateColumns: cols,
                        gridTemplateRows: `repeat(${lanes.length}, 36px)`,
                      }}
                    >
                      {lanes.flatMap((lane, laneIdx) =>
                        lane.map((bar) => {
                          const t = bar.item.task;
                          const cont =
                            bar.continuesLeft && bar.continuesRight
                              ? "both"
                              : bar.continuesLeft
                                ? "left"
                                : bar.continuesRight
                                  ? "right"
                                  : "none";
                          return (
                            <div
                              key={`${days[0]}-${t.id}`}
                              data-calendar-multiday={t.id}
                              data-calendar-continues={cont}
                              role="button"
                              tabIndex={0}
                              draggable
                              onDragStart={(e) => {
                                dragging.current = true;
                                e.dataTransfer.setData("text/atlas-task", String(t.id));
                              }}
                              onDragEnd={() => {
                                setTimeout(() => {
                                  dragging.current = false;
                                }, 0);
                              }}
                              onClick={() => {
                                if (dragging.current) return;
                                openTask(t.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") openTask(t.id);
                              }}
                              title="クリックで開く / ドラッグで期日を変更"
                              className={`${taskFace(t, true)} mx-1 rounded ${
                                bar.continuesLeft ? "rounded-l-none" : ""
                              } ${bar.continuesRight ? "rounded-r-none" : ""}`}
                              style={{
                                gridColumn: `${bar.colStart + 1} / ${bar.colEnd + 2}`,
                                gridRow: laneIdx + 1,
                              }}
                            >
                              {bar.continuesLeft && <span className="shrink-0 text-neutral-400">‹</span>}
                              {completion(t)}
                              {taskAvatars(t)}
                              <span className={`min-w-0 flex-1 truncate ${t.completed ? "line-through" : ""}`}>
                                {t.name}
                              </span>
                              {taskMeta(t)}
                              {bar.continuesRight && <span className="shrink-0 text-neutral-400">›</span>}
                            </div>
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
                    const adding = addingDate === iso;
                    const dt = new Date(day * 86_400_000);
                    const compact = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
                    return (
                      <div
                        key={iso}
                        data-calendar-day={iso}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => onDrop(e, iso)}
                        className={`group relative border-r border-b border-neutral-200 p-1 align-top ${
                          weekMode ? "min-h-[320px]" : "min-h-[120px]"
                        }`}
                      >
                        {dayTasks.map((t) => (
                          <div
                            key={t.id}
                            data-calendar-single={t.id}
                            role="button"
                            tabIndex={0}
                            draggable
                            onDragStart={(e) => {
                              dragging.current = true;
                              e.dataTransfer.setData("text/atlas-task", String(t.id));
                            }}
                            onDragEnd={() => {
                              setTimeout(() => {
                                dragging.current = false;
                              }, 0);
                            }}
                            onClick={() => {
                              if (dragging.current) return;
                              openTask(t.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") openTask(t.id);
                            }}
                            title="クリックで開く / ドラッグで期日を変更"
                            className={taskFace(t, false)}
                          >
                            {completion(t)}
                            {taskAvatars(t)}
                            <span className={`min-w-0 flex-1 truncate ${t.completed ? "line-through" : ""}`}>
                              {t.name}
                            </span>
                            {taskMeta(t)}
                          </div>
                        ))}
                        {adding ? (
                          <input
                            ref={inputRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitInlineAdd(iso);
                              if (e.key === "Escape") {
                                setAddingDate(null);
                                setDraft("");
                              }
                            }}
                            onBlur={() => {
                              if (!draft.trim()) setAddingDate(null);
                            }}
                            placeholder="タスク名を入力"
                            className="h-8 w-full rounded border border-blue-500 px-2 text-[13px] outline-none"
                          />
                        ) : (
                          !compact &&
                          !weekMode && (
                            <button
                              type="button"
                              onClick={() => startInlineAdd(iso)}
                              className="flex h-8 w-full items-center rounded px-1 text-left text-[12px] text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 focus:opacity-100"
                            >
                              ＋ タスクを追加
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function monthLabelShift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
