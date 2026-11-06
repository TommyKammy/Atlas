"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskRow } from "@/lib/data";
import { dayDeltaFromPixels, shiftDate } from "@/lib/timeline-dnd";
import { criticalPath } from "@/lib/critical-path";
import { positionBetween } from "@/lib/order";
import { todayISO } from "@/lib/dates";
import EmptyState from "./EmptyState";
import { usePersistedViewState } from "@/lib/view-state-client";

const DAY_MS = 86_400_000;

function toDay(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
}

// Asana-measured timeline metrics (REA, 2026-11-06):
// row pitch 40px, bar 34px + 4px radius, axis 49px (month + week rows),
// section header shares the first 40px task row, group hairlines #e1e1e1,
// daily grid #eaeaea, weekend stripes #eaeaea, 2px today stripe, 10px resize handles.
const ROW_PITCH = 40;
const BAR_H = 34;
const AXIS_H = 49;
const EDGE_HIT = 10;
const ZOOM_PRESETS = [
  { key: "hour", label: "時間", dayWidth: 5064 },
  { key: "day", label: "日", dayWidth: 40 },
  { key: "week", label: "週", dayWidth: 24 },
  { key: "month", label: "月", dayWidth: 12 },
  { key: "quarter", label: "四半期", dayWidth: 4 },
  { key: "half", label: "半年", dayWidth: 2 },
  { key: "year", label: "年", dayWidth: 1 },
] as const;
const AVATAR_COLORS = ["bg-violet-400", "bg-amber-400", "bg-emerald-500", "bg-sky-500", "bg-rose-400"];

type SortKey = "default" | "due" | "start" | "name";
type MenuKey = "filter" | "sort" | "options" | null;
type Draft = { sectionId: number | null; day: number; key: number } | null;

function avatarColor(name: string | null): string {
  const code = name ? name.charCodeAt(0) : 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

function isoWeek(day: number): number {
  const d = new Date(day * DAY_MS);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
}

function weekLabel(start: number): string {
  const a = new Date(start * DAY_MS);
  const b = new Date((start + 6) * DAY_MS);
  const range =
    a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()} - ${b.getUTCDate()}`
      : `${a.getUTCMonth() + 1}月${a.getUTCDate()}日 - ${b.getUTCDate()}`;
  // Weeks start on Sunday in the Asana timeline; ISO week numbers are Monday-based.
  return `W${isoWeek(start + 1)} ${range}`;
}

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}

export default function TimelineView({
  projectId,
  sections,
  tasks,
  deps,
  startOverride,
  initialState,
}: {
  projectId: number;
  sections: Section[];
  tasks: TaskRow[];
  deps: { task_id: number; depends_on_id: number }[];
  startOverride: number | null;
  initialState?: Record<string, string | number | boolean | null>;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<Draft>(null);
  const draftSeq = useRef(0);
  const suppressCanvasClick = useRef(false);
  const revealBarId = useRef<number | null>(null);
  const moved = useRef(false);

  const stored = initialState ?? {};
  const storedZoom =
    typeof stored.zoom === "number" && stored.zoom >= 0 && stored.zoom < ZOOM_PRESETS.length
      ? stored.zoom
      : 2;
  const storedSort =
    stored.sort === "due" || stored.sort === "start" || stored.sort === "name" ? (stored.sort as SortKey) : "default";
  const [zoom, setZoom] = useState(storedZoom);
  const [undatedOpen, setUndatedOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [collapsedHydrated, setCollapsedHydrated] = useState(false);
  const [draft, setDraft] = useState<Draft>(null);
  const [menu, setMenu] = useState<MenuKey>(null);
  const [hideCompleted, setHideCompleted] = useState(stored.hide_completed === true);
  const [assigneeFilter, setAssigneeFilter] = useState(
    typeof stored.assignee === "string" && stored.assignee !== "" ? stored.assignee : "all",
  );
  const [sortBy, setSortBy] = useState<SortKey>(storedSort);
  const [zoomMenu, setZoomMenu] = useState(false);
  const [showWeekends, setShowWeekends] = useState(stored.weekends !== false);
  const [showDependencies, setShowDependencies] = useState(stored.dependencies !== false);
  const [showCritical, setShowCritical] = useState(stored.critical !== false);
  usePersistedViewState(projectId, "timeline", {
    zoom,
    hide_completed: hideCompleted,
    assignee: assigneeFilter,
    sort: sortBy,
    weekends: showWeekends,
    dependencies: showDependencies,
    critical: showCritical,
  });
  const [hover, setHover] = useState<{ sectionId: number; top: number; height: number; day: number } | null>(null);
  const [barHoverId, setBarHoverId] = useState<number | null>(null);
  const [barOverflowId, setBarOverflowId] = useState<number | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [depLink, setDepLink] = useState<{
    fromId: number;
    edge: "start" | "end";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [depTargetId, setDepTargetId] = useState<number | null>(null);
  const [hoveredDep, setHoveredDep] = useState<string | null>(null);
  const barHoverTimer = useRef<number | null>(null);
  const barHoverIdRef = useRef<number | null>(null);
  const depHoverTimer = useRef<number | null>(null);
  const [drag, setDrag] = useState<{
    id: number;
    mode: "move" | "start" | "end";
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    drop: { sectionId: number; index: number; top: number } | null;
  } | null>(null);
  const zoomPreset = ZOOM_PRESETS[zoom];
  const dayWidth = zoomPreset.dayWidth;
  const pendingAnchor = useRef<{ day: number } | null>(null);
  const initialScrollDone = useRef(false);

  useEffect(() => {
    if (!draft) return;
    const raf = requestAnimationFrame(() => draftInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [draft?.key, draft]);

  useEffect(() => {
    const id = revealBarId.current;
    if (id === null) return;
    const el = document.querySelector<HTMLElement>(`[data-timeline-bar="${id}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      revealBarId.current = null;
    }
  }, [tasks]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setCanvasWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (barHoverTimer.current) window.clearTimeout(barHoverTimer.current);
    },
    [],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`atlas.timeline.collapsed.${projectId}`);
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setCollapsed(new Set(ids.filter((id): id is number => Number.isInteger(id))));
        }
      }
    } catch {
      // localStorage may be unavailable in private modes
    }
    setCollapsedHydrated(true);
  }, [projectId]);

  useEffect(() => {
    if (!collapsedHydrated) return;
    try {
      window.localStorage.setItem(
        `atlas.timeline.collapsed.${projectId}`,
        JSON.stringify([...collapsed]),
      );
    } catch {
      // localStorage may be unavailable in private modes
    }
  }, [collapsed, collapsedHydrated, projectId]);

  const assigneeNames = Array.from(
    new Set(tasks.map((t) => t.assignee_name).filter((name): name is string => Boolean(name))),
  ).sort((a, b) => a.localeCompare(b, "ja"));

  const visibleTasks = tasks.filter((t) => {
    if (hideCompleted && t.completed) return false;
    if (assigneeFilter === "none") return !t.assignee_name;
    if (assigneeFilter !== "all") return t.assignee_name === assigneeFilter;
    return true;
  });
  const dated = visibleTasks.filter((t) => toDay(t.start_on) !== null || toDay(t.due_on) !== null);
  const undated = visibleTasks.filter((t) => toDay(t.start_on) === null && toDay(t.due_on) === null);
  // Vertical reorder maps directly to task.position. Disable it while a
  // non-default sort or a filter hides rows, so the visual order stays truthful.
  const canReorder = sortBy === "default" && !hideCompleted && assigneeFilter === "all";

  let min = Number.MAX_SAFE_INTEGER;
  let max = Number.MIN_SAFE_INTEGER;
  for (const t of dated) {
    const s = toDay(t.start_on) ?? toDay(t.due_on)!;
    const e = toDay(t.due_on) ?? toDay(t.start_on)!;
    min = Math.min(min, s);
    max = Math.max(max, e);
  }
  if (dated.length === 0) {
    const today = toDay(todayISO())!;
    min = today - 7;
    max = today + 35;
  } else {
    min -= 3;
    max += 10;
    // Align the canvas to whole weeks so the first/last axis labels are not
    // squeezed into a partial cell.
    min -= new Date(min * DAY_MS).getUTCDay();
    max += 6 - new Date(max * DAY_MS).getUTCDay();
  }
  if (startOverride !== null) {
    min = startOverride;
    if (max < min) max = min + 30;
  }
  let span = Math.max(1, max - min + 1);
  // Keep enough content around the tasks so coarse zoom levels do not stretch
  // a short project across the viewport (Asana extends its timeline range).
  const desiredSpan = Math.max(1, Math.ceil(1680 / dayWidth));
  if (span < desiredSpan) {
    const extra = desiredSpan - span;
    const before = Math.floor(extra / 2);
    min -= before;
    max += extra - before;
    span = Math.max(1, max - min + 1);
  }
  const dayPct = 100 / span;
  const pct = (d: number) => `${((d - min) / span) * 100}%`;

  const changeZoom = (next: number) => {
    const clamped = Math.max(0, Math.min(ZOOM_PRESETS.length - 1, next));
    if (clamped === zoom) return;
    const scroller = scrollRef.current;
    if (scroller) {
      const width = contentRef.current?.offsetWidth ?? Math.max(700, span * dayWidth);
      const centerX = scroller.scrollLeft + scroller.clientWidth / 2;
      pendingAnchor.current = { day: min + (centerX / Math.max(1, width)) * span };
    }
    setZoom(clamped);
  };

  useEffect(() => {
    const pending = pendingAnchor.current;
    if (!pending) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const width = contentRef.current?.offsetWidth ?? Math.max(700, span * dayWidth);
    const x = ((pending.day - min) / span) * width;
    scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
    pendingAnchor.current = null;
  }, [zoom, min, span, dayWidth]);

  const bySection = new Map<number | null, TaskRow[]>();
  for (const t of dated) {
    const k = t.eff_section_id ?? t.section_id;
    if (!bySection.has(k)) bySection.set(k, []);
    bySection.get(k)!.push(t);
  }
  if (sortBy !== "default") {
    const cmpDate = (a: string | null, b: string | null) =>
      (a ?? "9999-12-31").localeCompare(b ?? "9999-12-31");
    for (const [key, list] of bySection) {
      const sorted = [...list];
      if (sortBy === "due") sorted.sort((a, b) => cmpDate(a.due_on, b.due_on) || a.id - b.id);
      else if (sortBy === "start") sorted.sort((a, b) => cmpDate(a.start_on, b.start_on) || a.id - b.id);
      else if (sortBy === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "ja"));
      bySection.set(key, sorted);
    }
  }

  // Section groups carry absolute offsets so a click anywhere in the canvas can
  // resolve section + date, like Asana's timeline canvas.
  let cursorY = AXIS_H;
  const groups: {
    section: Section;
    tasks: TaskRow[];
    all: TaskRow[];
    collapsed: boolean;
    hasDraft: boolean;
    top: number;
    height: number;
  }[] = [];
  for (const section of sections) {
    const all = bySection.get(section.id) ?? [];
    const isCollapsed = collapsed.has(section.id);
    const hasDraft = !isCollapsed && draft?.sectionId === section.id;
    const shown = isCollapsed ? [] : all;
    // Asana shares the section header row with the first task row. The header
    // itself is one 40px row, and subsequent tasks add one row each.
    const height = isCollapsed
      ? ROW_PITCH
      : Math.max(all.length, 1) * ROW_PITCH + (hasDraft ? ROW_PITCH : 0);
    groups.push({ section, tasks: shown, all, collapsed: isCollapsed, hasDraft, top: cursorY, height });
    cursorY += height;
  }

  // Absolute y centers for dependency edges (axis + headers + task rows).
  const rowY = new Map<number, number>();
  const pos = new Map<number, { x1: string; x2: string }>();
  for (const group of groups) {
    for (let i = 0; i < group.tasks.length; i++) {
      const t = group.tasks[i];
      const st = toDay(t.start_on) ?? toDay(t.due_on)!;
      const en = toDay(t.due_on) ?? toDay(t.start_on)!;
      rowY.set(t.id, group.top + i * ROW_PITCH + ROW_PITCH / 2);
      pos.set(t.id, { x1: pct(Math.max(st, min)), x2: pct(Math.min(en, max) + 1) });
    }
  }
  const edges = showDependencies
    ? deps.filter((d) => rowY.has(d.task_id) && rowY.has(d.depends_on_id))
    : [];
  const dependencyShapes = edges.map((e) => {
    const fromPct = pos.get(e.depends_on_id)!;
    const toPct = pos.get(e.task_id)!;
    const from = { x: (parseFloat(fromPct.x2) / 100) * canvasWidth };
    const to = { x: (parseFloat(toPct.x1) / 100) * canvasWidth };
    const y1 = rowY.get(e.depends_on_id)!;
    const y2 = rowY.get(e.task_id)!;
    const midX = to.x >= from.x + 24 ? from.x + (to.x - from.x) / 2 : from.x + 14;
    return {
      e,
      key: `${e.depends_on_id}-${e.task_id}`,
      d: `M ${from.x} ${y1} H ${midX} V ${y2} H ${to.x}`,
      arrow: `M ${to.x} ${y2} L ${to.x - 7} ${y2 - 4} L ${to.x - 7} ${y2 + 4} Z`,
      from,
      to,
      y1,
      y2,
      midX,
      midY: (y1 + y2) / 2,
    };
  });
  const hoveredShape = hoveredDep
    ? dependencyShapes.find((shape) => shape.key === hoveredDep)
    : undefined;

  const showDepHover = (key: string) => {
    if (depHoverTimer.current) {
      window.clearTimeout(depHoverTimer.current);
      depHoverTimer.current = null;
    }
    setHoveredDep(key);
  };
  const scheduleDepHoverClear = () => {
    if (depHoverTimer.current) window.clearTimeout(depHoverTimer.current);
    depHoverTimer.current = window.setTimeout(() => {
      setHoveredDep(null);
      depHoverTimer.current = null;
    }, 180);
  };
  const critical = criticalPath(
    dated.map((t) => ({ id: t.id, start_on: t.start_on, due_on: t.due_on })),
    deps,
  );

  const todayDay = toDay(todayISO())!;
  const showToday = todayDay >= min && todayDay <= max;

  useEffect(() => {
    if (initialScrollDone.current) return;
    const scroller = scrollRef.current;
    const canvas = contentRef.current;
    if (!scroller || !canvas || canvas.offsetWidth === 0) return;
    const x = ((todayDay - min) / span) * canvas.offsetWidth;
    scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
    initialScrollDone.current = true;
  }, [min, span, todayDay]);
  const firstWeek = min - new Date(min * DAY_MS).getUTCDay();
  const lastWeek = max + (6 - new Date(max * DAY_MS).getUTCDay());
  const weeks: { start: number; left: number; right: number; label: string }[] = [];
  for (let d = firstWeek; d <= lastWeek; d += 7) {
    if (d + 6 < min || d > max) continue;
    weeks.push({
      start: d,
      left: Math.max(d, min),
      right: Math.min(d + 6, max),
      label: weekLabel(d),
    });
  }
  const weekLines: number[] = [];
  for (let d = firstWeek; d <= lastWeek; d += 7) {
    if (d >= min && d <= max) weekLines.push(d);
  }

  const months: { start: number; end: number; label: string }[] = [];
  for (let d = min; d <= max; ) {
    const dt = new Date(d * DAY_MS);
    const yNum = dt.getUTCFullYear();
    const mNum = dt.getUTCMonth();
    const next = Date.UTC(yNum, mNum + 1, 1) / DAY_MS;
    months.push({ start: d, end: Math.min(next - 1, max), label: `${mNum + 1}月` });
    d = next;
  }

  const days: number[] = [];
  const weekendDays: number[] = [];
  for (let d = min; d <= max; d++) {
    days.push(d);
    const wd = new Date(d * DAY_MS).getUTCDay();
    if (wd === 0 || wd === 6) weekendDays.push(d);
  }

  type AxisInterval = { key: string; start: number; end: number; label: string; daysWide: number };
  const buildIntervals = (keyOf: (d: number) => { key: string; label: string }): AxisInterval[] => {
    const out: Array<Omit<AxisInterval, "daysWide">> = [];
    let current: Omit<AxisInterval, "daysWide"> | null = null;
    for (let d = min; d <= max; d++) {
      const { key, label } = keyOf(d);
      if (!current || current.key !== key) {
        if (current) current.end = d - 1;
        current = { key, start: d, end: d, label };
        out.push(current);
      } else {
        current.end = d;
      }
    }
    return out.map((interval) => ({ ...interval, daysWide: interval.end - interval.start + 1 }));
  };
  const monthIntervals = buildIntervals((d) => {
    const dt = new Date(d * DAY_MS);
    return { key: `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`, label: `${dt.getUTCMonth() + 1}月` };
  });
  const yearIntervals = buildIntervals((d) => {
    const y = new Date(d * DAY_MS).getUTCFullYear();
    return { key: `${y}`, label: `${y}年` };
  });
  const quarterIntervals = buildIntervals((d) => {
    const dt = new Date(d * DAY_MS);
    const q = Math.floor(dt.getUTCMonth() / 3) + 1;
    return { key: `${dt.getUTCFullYear()}-Q${q}`, label: `Q${q}` };
  });
  const dayIntervals = buildIntervals((d) => {
    const dt = new Date(d * DAY_MS);
    return { key: `${d}`, label: `${dt.getUTCDate()}` };
  });
  const hourDayIntervals = buildIntervals((d) => {
    const dt = new Date(d * DAY_MS);
    return { key: `${d}`, label: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}` };
  });
  const hourIntervals: AxisInterval[] = [];
  for (let d = min; d <= max; d++) {
    for (let h = 0; h < 24; h++) {
      hourIntervals.push({
        key: `${d}-${h}`,
        start: d + h / 24,
        end: d + (h + 1) / 24,
        label: `${h}:00`,
        daysWide: 1 / 24,
      });
    }
  }
  const axisTop =
    zoomPreset.key === "hour"
      ? hourDayIntervals
      : zoomPreset.key === "day" || zoomPreset.key === "week"
        ? monthIntervals
        : yearIntervals;
  const axisBottom =
    zoomPreset.key === "hour"
      ? hourIntervals
      : zoomPreset.key === "day"
        ? dayIntervals
        : zoomPreset.key === "week"
          ? weeks.map((w) => ({
              key: `w-${w.start}`,
              start: w.left,
              end: w.right,
              label: w.label,
              daysWide: w.right - w.left + 1,
            }))
          : zoomPreset.key === "month" || zoomPreset.key === "quarter"
            ? monthIntervals
            : quarterIntervals;
  const gridLines =
    zoomPreset.key === "hour"
      ? hourIntervals.filter((h) => !h.label.startsWith("0:00")).map((h) => h.start)
      : zoomPreset.key === "day" || zoomPreset.key === "week"
        ? days
        : zoomPreset.key === "month"
          ? weekLines
          : zoomPreset.key === "quarter"
            ? monthIntervals.map((m) => m.start)
            : quarterIntervals.map((q) => q.start);

  const commitChange = async (
    t: TaskRow,
    delta: number,
    mode: "move" | "start" | "end",
    extra: Record<string, unknown> = {},
  ) => {
    const baseStart = t.start_on ?? t.due_on!;
    const baseEnd = t.due_on ?? t.start_on!;
    let nextStart: string | null = null;
    let nextEnd: string | null = null;
    try {
      if (delta !== 0) {
        if (mode === "move") {
          nextStart = t.start_on ? shiftDate(baseStart, delta) : null;
          nextEnd = t.due_on ? shiftDate(baseEnd, delta) : null;
        } else if (mode === "start") {
          const cand = shiftDate(baseStart, delta);
          nextStart = cand <= (t.due_on ?? cand) ? cand : (t.due_on ?? cand);
        } else if (mode === "end") {
          const cand = shiftDate(baseEnd, delta);
          nextEnd = cand >= (t.start_on ?? cand) ? cand : (t.start_on ?? cand);
        }
      }
    } catch {
      return;
    }
    if (nextStart === null && nextEnd === null && Object.keys(extra).length === 0) return;
    const res = await fetch(`/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(nextStart !== null ? { start_on: nextStart } : {}),
        ...(nextEnd !== null ? { due_on: nextEnd } : {}),
        ...extra,
        expected_updated_at: t.updated_at,
      }),
    });
    if (res.status === 409) {
      alert("他のユーザーが先に更新しました。最新を表示します。");
    } else if (!res.ok) {
      alert(`変更に失敗しました: ${res.status}`);
    }
    refresh();
  };

  const toggleComplete = async (t: TaskRow) => {
    const res = await fetch(`/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        completed: !t.completed,
        progress: t.completed ? t.progress : 100,
        expected_updated_at: t.updated_at,
      }),
    });
    if (res.status === 409) alert("他のユーザーが先に更新しました。最新を表示します。");
    else if (!res.ok) alert(`更新に失敗しました: ${res.status}`);
    refresh();
  };

  const computeDrop = (id: number, clientY: number) => {
    if (!canReorder) return null;
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const y = clientY - rect.top;
    const group = groups.find((g) => !g.collapsed && y >= g.top && y < g.top + g.height);
    if (!group) return null;
    const list = group.tasks;
    const sourceIndex = list.findIndex((x) => x.id === id);
    const local = y - group.top;
    const row = Math.floor(local / ROW_PITCH);
    const within = local - row * ROW_PITCH;
    let raw = row + (within > ROW_PITCH / 2 ? 1 : 0);
    raw = Math.max(0, Math.min(list.length, raw));
    const maxIndex = list.length - (sourceIndex >= 0 ? 1 : 0);
    let index = raw > sourceIndex && sourceIndex >= 0 ? raw - 1 : raw;
    index = Math.max(0, Math.min(maxIndex, index));
    // Keep the insertion line in the real (source row still present) layout.
    const boundary = sourceIndex >= 0 && index > sourceIndex ? index + 1 : index;
    return {
      sectionId: group.section.id,
      index,
      top: group.top + boundary * ROW_PITCH,
    };
  };

  const beginDrag = (e: React.PointerEvent, t: TaskRow, mode: "move" | "start" | "end") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    moved.current = false;
    setHover(null);
    setBarHoverId(null);
    if (barHoverTimer.current) {
      window.clearTimeout(barHoverTimer.current);
      barHoverTimer.current = null;
    }
    setDrag({
      id: t.id,
      mode,
      dx: 0,
      dy: 0,
      startX: e.clientX,
      startY: e.clientY,
      drop: null,
    });
  };

  const beginBarDrag = (e: React.PointerEvent, t: TaskRow) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromLeft = e.clientX - rect.left;
    const fromRight = rect.right - e.clientX;
    const edgeHit = edgeHitFor(rect.width);
    const mode: "move" | "start" | "end" =
      fromLeft <= edgeHit && fromLeft <= fromRight
        ? "start"
        : fromRight <= edgeHit
          ? "end"
          : "move";
    beginDrag(e, t, mode);
  };

  const onBarMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const scroller = scrollRef.current;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const edge = 48;
      if (e.clientX < rect.left + edge) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - 14);
      else if (e.clientX > rect.right - edge) scroller.scrollLeft += 14;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 4) moved.current = true;
    const drop =
      drag.mode === "move" && Math.abs(dy) >= 8 ? computeDrop(drag.id, e.clientY) : null;
    setDrag({ ...drag, dx, dy, drop });
  };
  const onBarUp = async () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    const el = contentRef.current;
    if (!el) {
      refresh();
      return;
    }
    const t = tasks.find((x) => x.id === d.id);
    if (!t) return;
    const delta = dayDeltaFromPixels(d.dx, el.getBoundingClientRect().width, span);
    const extra: Record<string, unknown> = {};
    if (d.mode === "move" && d.drop) {
      const target = groups.find((g) => g.section.id === d.drop!.sectionId);
      if (target) {
        const sourceSection = t.eff_section_id ?? t.section_id;
        const filtered = target.all.filter((x) => x.id !== t.id);
        const index = Math.min(d.drop.index, filtered.length);
        const sourceIndex = target.all.findIndex((x) => x.id === t.id);
        if (!(sourceSection === target.section.id && index === sourceIndex)) {
          extra.position = positionBetween(
            index > 0 ? filtered[index - 1].position : null,
            index < filtered.length ? filtered[index].position : null,
          );
          if (sourceSection !== target.section.id) extra.section_id = target.section.id;
        }
      }
    }
    await commitChange(t, delta, d.mode, extra);
  };

  const dragDelta = (id: number) => (drag && drag.id === id ? drag.dx : 0);

  const beginDependency = (e: React.PointerEvent, t: TaskRow, edge: "start" | "end") => {
    e.preventDefault();
    e.stopPropagation();
    const content = contentRef.current;
    const bar = document.querySelector<HTMLElement>(`[data-timeline-bar="${t.id}"]`);
    if (!content || !bar) return;
    const contentRect = content.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const x = (edge === "start" ? barRect.left : barRect.right) - contentRect.left;
    const y = barRect.top + barRect.height / 2 - contentRect.top;
    setDepTargetId(null);
    setDepLink({ fromId: t.id, edge, x1: x, y1: y, x2: x, y2: y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDependency = (e: React.PointerEvent) => {
    const content = contentRef.current;
    if (!content || !depLink) return;
    const scroller = scrollRef.current;
    if (scroller) {
      const sr = scroller.getBoundingClientRect();
      if (e.clientX > sr.right - 36) scroller.scrollLeft += 14;
      else if (e.clientX < sr.left + 36) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - 14);
    }
    const rect = content.getBoundingClientRect();
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-timeline-bar]");
    const targetId = Number(target?.getAttribute("data-timeline-bar"));
    setDepTargetId(
      target && Number.isInteger(targetId) && targetId !== depLink.fromId ? targetId : null,
    );
    setDepLink((link) =>
      link ? { ...link, x2: e.clientX - rect.left, y2: e.clientY - rect.top } : link,
    );
  };

  const endDependency = async (e: React.PointerEvent) => {
    if (!depLink) return;
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-timeline-bar]");
    const targetId = Number(target?.getAttribute("data-timeline-bar"));
    const { fromId, edge } = depLink;
    setDepLink(null);
    setDepTargetId(null);
    if (!targetId || Number.isNaN(targetId) || targetId === fromId) return;
    const payload =
      edge === "start"
        ? { task_id: fromId, depends_on_id: targetId }
        : { task_id: targetId, depends_on_id: fromId };
    const res = await fetch("/api/dependencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (res.status === 409) alert("循環依存は作成できません");
      return;
    }
    refresh();
  };

  const removeDependency = async (dep: { task_id: number; depends_on_id: number }) => {
    const res = await fetch(
      `/api/dependencies?task_id=${dep.task_id}&depends_on_id=${dep.depends_on_id}`,
      { method: "DELETE" },
    );
    if (!res.ok) return;
    setHoveredDep(null);
    refresh();
  };

  const showBarHover = (id: number) => {
    if (barHoverTimer.current) {
      window.clearTimeout(barHoverTimer.current);
      barHoverTimer.current = null;
    }
    barHoverIdRef.current = id;
    setBarHoverId(id);
    // Asana only shows the bar tooltip when the task name is clipped by the
    // bar. Measure after the hover inset is painted.
    window.requestAnimationFrame(() => {
      if (barHoverIdRef.current !== id) return;
      const nameEl = document.querySelector<HTMLElement>(
        `[data-timeline-bar="${id}"] [data-timeline-bar-name]`,
      );
      if (!nameEl) {
        setBarOverflowId(null);
        return;
      }
      const clipped =
        nameEl.scrollHeight > nameEl.clientHeight + 1 ||
        nameEl.scrollWidth > nameEl.clientWidth + 1;
      setBarOverflowId(clipped ? id : null);
    });
  };
  const scheduleBarHoverClear = () => {
    if (barHoverTimer.current) window.clearTimeout(barHoverTimer.current);
    barHoverTimer.current = window.setTimeout(() => {
      barHoverIdRef.current = null;
      setBarHoverId(null);
      setBarOverflowId(null);
      barHoverTimer.current = null;
    }, 160);
  };

  const linkDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);

  const openTask = (id: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set("task", String(id));
    router.push(`/projects/${projectId}?${q.toString()}`);
  };

  const openDraft = (sectionId: number | null, day: number) => {
    if (sectionId !== null) {
      setCollapsed((prev) => {
        if (!prev.has(sectionId)) return prev;
        const next = new Set(prev);
        next.delete(sectionId);
        return next;
      });
    }
    draftSeq.current += 1;
    const next: Draft = { sectionId, day, key: draftSeq.current };
    draftRef.current = next;
    setDraft(next);
    setHover(null);
  };

  const finishDraft = (value: string) => {
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = null;
    setDraft(null);
    const name = value.trim();
    if (!name) return;
    void (async () => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          section_id: current.sectionId,
          name,
          start_on: linkDay(current.day),
          due_on: linkDay(current.day),
        }),
      });
      if (!res.ok) {
        alert(`作成に失敗しました: ${res.status}`);
        return;
      }
      const created = await res.json();
      revealBarId.current = created.id ?? null;
      refresh();
    })();
  };

  const addToday = () => {
    if (sections.length === 0) {
      void addSection();
      return;
    }
    openDraft(sections[0].id, Math.min(max, Math.max(min, todayDay)));
  };

  const addSection = async () => {
    const name = prompt("セクション名");
    if (!name?.trim()) return;
    await api("/api/sections", "POST", { project_id: projectId, name: name.trim() });
    refresh();
  };

  const toggleSection = (id: number) => {
    if (draftRef.current?.sectionId === id) finishDraft(draftInputRef.current?.value ?? "");
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dayAtX = (clientX: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return min;
    const frac = Math.min(0.999999, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(max, Math.max(min, Math.floor(min + frac * span)));
  };

  const sectionAtY = (y: number) => {
    const hit = groups.find((g) => y >= g.top && y < g.top + g.height);
    if (hit) return hit;
    if (y >= AXIS_H && groups.length > 0) return groups[groups.length - 1];
    return null;
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".tl-bar,input,button,a,textarea,select")) return;
    // A click that dismisses an open draft should not immediately create another.
    if (suppressCanvasClick.current) {
      suppressCanvasClick.current = false;
      return;
    }
    if (draftRef.current) return;
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    if (y < AXIS_H) return;
    const group = sectionAtY(y);
    if (!group) return;
    openDraft(group.section.id, dayAtX(e.clientX));
  };

  const onCanvasMove = (e: React.PointerEvent) => {
    if (drag || draftRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest(".tl-bar,input,button,a")) {
      setHover(null);
      return;
    }
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return;
    const group = sectionAtY(e.clientY - rect.top);
    if (!group) {
      setHover(null);
      return;
    }
    const day = dayAtX(e.clientX);
    setHover((prev) =>
      prev && prev.sectionId === group.section.id && prev.day === day
        ? prev
        : { sectionId: group.section.id, top: group.top, height: group.height, day },
    );
  };

  const barFace = (t: TaskRow) => {
    if (t.completed) return "bg-[#aaaaaa] text-[#050505]";
    if (showCritical && critical.has(t.id)) return "bg-red-200 text-neutral-900";
    return "bg-white text-[#050505] shadow-[0_0_0_1px_#eaeaea,0_1px_4px_rgba(118,118,118,0.08)]";
  };

  const barPxFor = (t: TaskRow) => {
    const startDay = toDay(t.start_on) ?? toDay(t.due_on)!;
    const endDay = toDay(t.due_on) ?? toDay(t.start_on)!;
    return (endDay - startDay + 1) * dayWidth;
  };

  // Leave a usable centre grip even on one- or two-day bars. Desktop Asana uses
  // 10px handles, but Atlas clamps them on short bars so vertical reorder still
  // has a draggable centre.
  const edgeHitFor = (width: number) => Math.min(EDGE_HIT, Math.max(4, width / 4));

  const barStyle = (t: TaskRow): React.CSSProperties => {
    const p = pos.get(t.id)!;
    const d = drag && drag.id === t.id ? drag : null;
    const style: React.CSSProperties = {
      height: BAR_H,
      left: p.x1,
      width: `calc(${p.x2} - ${p.x1})`,
    };
    if (!d) return style;
    if (d.mode === "move") {
      style.transform = canReorder
        ? `translate(${d.dx}px, ${d.dy}px)`
        : `translateX(${d.dx}px)`;
    } else if (d.mode === "start") {
      style.left = `calc(${p.x1} + ${d.dx}px)`;
      style.width = `max(2px, calc(${p.x2} - ${p.x1} - ${d.dx}px))`;
    } else if (d.mode === "end") {
      style.width = `max(2px, calc(${p.x2} - ${p.x1} + ${d.dx}px))`;
    }
    return style;
  };

  const handleStyle = (t: TaskRow, edge: "start" | "end"): React.CSSProperties => {
    const p = pos.get(t.id)!;
    const d = drag && drag.id === t.id ? drag : null;
    const hit = edgeHitFor(barPxFor(t));
    let left = edge === "start" ? p.x1 : p.x2;
    if (d?.mode === "start") left = `calc(${p.x1} + ${d.dx}px)`;
    else if (d?.mode === "end") left = `calc(${p.x2} + ${d.dx}px)`;
    else if (d?.mode === "move") left = `calc(${edge === "start" ? p.x1 : p.x2} + ${d.dx}px)`;
    return {
      height: BAR_H,
      width: hit,
      left,
      marginLeft: edge === "end" ? -hit : 0,
    };
  };

  const renderBar = (t: TaskRow) => {
    const dx = dragDelta(t.id);
    const active = drag?.id === t.id;
    const barPx = barPxFor(t);
    const showAvatar = Boolean(t.assignee_name) && barPx >= 140;
    const showSubtasks = t.subtask_count > 0 && barPx >= 160;
    const p = pos.get(t.id)!;
    const leftPct = parseFloat(p.x1);
    const sameDay = t.start_on !== null && t.due_on !== null && t.start_on === t.due_on;
    const skinny = barPx < 52;
    const labelOnLeft = leftPct > 72;
    const completionLeft = `calc(${p.x1} + 4px)`;
    const barInfo = `${t.name}（${t.start_on ?? "?"} 〜 ${t.due_on ?? "?"}・進捗${t.progress}%${t.assignee_name ? `・担当${t.assignee_name}` : ""}）${!t.completed && showCritical && critical.has(t.id) ? "【クリティカルパス】" : ""} — ドラッグで移動、上下で並び替え、左右端で期間変更`;
    return (
      <div key={t.id} className="relative h-10" data-timeline-row={t.id}>
        <div
          data-timeline-bar={t.id}
          data-timeline-dependency-target={depTargetId === t.id ? "true" : undefined}
          aria-label={barInfo}
          onPointerDown={(e) => beginBarDrag(e, t)}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerEnter={() => showBarHover(t.id)}
          onPointerLeave={scheduleBarHoverClear}
          onClick={(e) => {
            e.stopPropagation();
            if (!moved.current) openTask(t.id);
          }}
          className={`tl-bar absolute top-[3px] flex min-w-2 cursor-grab select-none touch-none items-center gap-1.5 overflow-visible rounded-[4px] px-2 text-[12px] active:cursor-grabbing hover:z-30 hover:shadow-[0_2px_8px_rgba(0,0,0,0.18)] ${barFace(t)} ${
            active ? "z-30 shadow-lg" : "z-10"
          } ${depTargetId === t.id ? "ring-2 ring-[#2c60b8] ring-offset-1" : ""} ${
            dx !== 0 ? "opacity-80" : ""
          }`}
          style={{
            ...barStyle(t),
            ...(barHoverId === t.id && !sameDay ? { paddingLeft: 26 } : {}),
          }}
        >
          {!skinny && showAvatar && t.assignee_name && (
            <span
              title={t.assignee_name}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-neutral-900 ${avatarColor(t.assignee_name)}`}
            >
              {t.assignee_name.slice(0, 1)}
            </span>
          )}
          {skinny || sameDay ? (
            <span
              data-timeline-bar-label={t.id}
              dir="auto"
              title={t.name}
              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-[12px] font-medium whitespace-nowrap text-[#050505] ${
                labelOnLeft ? "right-full mr-2 text-right" : "left-full ml-2"
              } ${t.completed ? "line-through" : ""}`}
              style={{ maxWidth: 172 }}
            >
              {t.name}
            </span>
          ) : (
            <span
              data-timeline-bar-name={t.id}
              dir="auto"
              className={`pointer-events-none line-clamp-2 min-w-0 flex-1 leading-[14px] ${t.completed ? "line-through" : ""}`}
            >
              {t.name}
            </span>
          )}
          {!skinny && showSubtasks && (
            <span className="pointer-events-none flex shrink-0 items-center gap-0.5 text-[11px] text-neutral-700" title="サブタスク">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M4 3v4.5a2 2 0 0 0 2 2h6" />
                <path d="M9.5 7.5 12 9.5 9.5 11.5" />
              </svg>
              {t.subtask_count}
            </span>
          )}
        </div>
        <div
          data-timeline-handle="start"
          title="開始日を変更"
          onPointerDown={(e) => beginDrag(e, t, "start")}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onClick={(e) => e.stopPropagation()}
          className="tl-bar absolute top-[3px] z-20 cursor-ew-resize touch-none rounded-l-[4px] bg-transparent transition-colors hover:bg-[#2c60b8]/90"
          style={handleStyle(t, "start")}
        />
        <div
          data-timeline-handle="end"
          title="期日を変更"
          onPointerDown={(e) => beginDrag(e, t, "end")}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onClick={(e) => e.stopPropagation()}
          className="tl-bar absolute top-[3px] z-20 cursor-ew-resize touch-none rounded-r-[4px] bg-transparent transition-colors hover:bg-[#2c60b8]/90"
          style={handleStyle(t, "end")}
        />
        {!active && (
          <>
            <button
              type="button"
              data-timeline-dependency-handle={t.id}
              data-timeline-dependency-direction="precedent"
              aria-label="先行タスクとの依存関係を作成"
              title="ドラッグして依存関係を作成"
              onPointerDown={(e) => beginDependency(e, t, "start")}
              onPointerMove={moveDependency}
              onPointerUp={(e) => void endDependency(e)}
              onPointerEnter={() => showBarHover(t.id)}
              onPointerLeave={scheduleBarHoverClear}
              onClick={(e) => e.stopPropagation()}
              data-timeline-dependency-placement="top"
              style={{ left: `calc(${p.x1} + 8px)`, top: -8 }}
              className={`absolute z-40 flex h-3.5 w-3.5 cursor-crosshair items-center justify-center rounded-full border border-neutral-400 bg-white shadow-sm hover:border-[#2c60b8] hover:bg-[#2c60b8] ${
                barHoverId === t.id ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <span className="h-0 w-0 border-x-[3px] border-b-[4px] border-x-transparent border-b-neutral-500" />
            </button>
            <button
              type="button"
              data-timeline-dependency-handle={t.id}
              data-timeline-dependency-direction="dependent"
              aria-label="後続タスクとの依存関係を作成"
              title="ドラッグして依存関係を作成"
              onPointerDown={(e) => beginDependency(e, t, "end")}
              onPointerMove={moveDependency}
              onPointerUp={(e) => void endDependency(e)}
              onPointerEnter={() => showBarHover(t.id)}
              onPointerLeave={scheduleBarHoverClear}
              onClick={(e) => e.stopPropagation()}
              data-timeline-dependency-placement="bottom"
              style={{ left: `max(calc(${p.x1} + 8px), calc(${p.x2} - 22px))`, top: 32 }}
              className={`absolute z-40 flex h-3.5 w-3.5 cursor-crosshair items-center justify-center rounded-full border border-neutral-400 bg-white shadow-sm hover:border-[#2c60b8] hover:bg-[#2c60b8] ${
                barHoverId === t.id ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <span className="h-0 w-0 border-x-[3px] border-t-[4px] border-x-transparent border-t-neutral-500" />
            </button>
          </>
        )}
        {!active && barHoverId === t.id && (
          <>
            <button
              type="button"
              data-timeline-complete={t.id}
              aria-label={t.completed ? "未完了に戻す" : "完了にする"}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerEnter={() => showBarHover(t.id)}
              onPointerLeave={scheduleBarHoverClear}
              onClick={(e) => {
                e.stopPropagation();
                toggleComplete(t);
              }}
              style={{ left: completionLeft, top: 12 }}
              className={`absolute z-30 flex h-4 w-4 items-center justify-center rounded-full border shadow-sm ${
                t.completed
                  ? "border-green-700 bg-green-700 text-white"
                  : "border-neutral-400 bg-white text-transparent hover:border-green-700 hover:text-green-700"
              }`}
            >
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M2.5 6.2 5 8.6l4.5-5" />
              </svg>
            </button>

            {barOverflowId === t.id && !skinny && !sameDay && (
              <span
                data-timeline-bar-tooltip={t.id}
                role="tooltip"
                className="pointer-events-none absolute z-50 w-max max-w-[260px] whitespace-normal rounded-[4px] bg-[#333] px-3 py-2 text-[12px] leading-[18px] text-[#f3f3f3] shadow-[0_1px_4px_rgba(118,118,118,0.08)]"
                style={
                  labelOnLeft
                    ? { right: `calc(100% - ${p.x1} + 8px)`, top: "50%", transform: "translateY(-50%)" }
                    : { left: `calc(${p.x2} + 8px)`, top: "50%", transform: "translateY(-50%)" }
                }
              >
                <span
                  aria-hidden
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 rounded-[1px] bg-[#333]"
                  style={labelOnLeft ? { right: -5 } : { left: -5 }}
                />
                <span dir="auto" className="relative block break-words">{t.name}</span>
                <span className="relative mt-0.5 block text-[11px] leading-4 text-neutral-300">
                  {t.start_on ?? "?"} 〜 {t.due_on ?? "?"}
                  {t.assignee_name ? ` ・ ${t.assignee_name}` : ""}
                </span>
              </span>
            )}
          </>
        )}
        {active && drag.mode !== "move" && (
          <span
            className="pointer-events-none absolute top-0 z-30 h-10 w-px bg-[#2c60b8]"
            style={{ left: handleStyle(t, drag.mode === "start" ? "start" : "end").left }}
          />
        )}
      </div>
    );
  };

  const filterActive = hideCompleted || assigneeFilter !== "all";
  const sortActive = sortBy !== "default";
  const optionsActive = !showWeekends || !showDependencies || !showCritical;

  const menuButtonClass = (active: boolean, open: boolean) =>
    `flex h-7 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-neutral-100 ${
      open || active ? "bg-[#eff4fd] text-[#2c60b8]" : "text-neutral-700"
    }`;

  return (
    <div
      className="pb-16 text-sm"
      data-timeline
      data-timeline-zoom={zoom}
      data-timeline-zoom-level={zoomPreset.label}
      data-timeline-zoom-preset={zoomPreset.key}
      data-timeline-hide-completed={hideCompleted}
      data-timeline-sort={sortBy}
      data-timeline-weekends={showWeekends}
      data-timeline-dependencies={showDependencies}
      data-timeline-critical={showCritical}
      data-timeline-assignee={assigneeFilter}
    >
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
        <button
          type="button"
          onClick={addToday}
          data-timeline-add
          className="flex h-7 items-center gap-1 rounded-md border border-[#e1e1e1] bg-white px-2.5 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50"
        >
          <span className="text-[15px] leading-none">＋</span> タスクを追加
        </button>
        <a
          href={`/projects/${projectId}?view=timeline&from=${linkDay(min - 30)}`}
          aria-label="前の期間"
          title="前の期間"
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100"
        >
          ‹
        </a>
        <a href={`/projects/${projectId}?view=timeline`} className="flex h-7 items-center rounded-md px-2 text-[13px] text-neutral-700 hover:bg-neutral-100">
          今日
        </a>
        <a
          href={`/projects/${projectId}?view=timeline&from=${linkDay(min + 30)}`}
          aria-label="次の期間"
          title="次の期間"
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100"
        >
          ›
        </a>
        {showCritical && (
          <span className="ml-2 flex items-center gap-1 text-xs text-neutral-500">
            <span className="inline-block h-2.5 w-4 rounded bg-red-200" /> クリティカルパス
          </span>
        )}
        <span className="ml-auto" />
        <button
          type="button"
          data-timeline-undated
          onClick={() => setUndatedOpen((v) => !v)}
          className={`flex h-7 items-center rounded-md px-2 text-[13px] hover:bg-neutral-100 ${
            undatedOpen ? "bg-[#eff4fd] text-[#2c60b8]" : "text-neutral-700"
          }`}
        >
          日付なしのタスク ({undated.length} 件)
        </button>
        <span className="relative">
          <button
            type="button"
            data-timeline-zoom-level={zoomPreset.label}
            aria-label={`ズームレベル: ${zoomPreset.label}`}
            aria-haspopup="listbox"
            aria-expanded={zoomMenu}
            onClick={() => setZoomMenu((v) => !v)}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-neutral-700 hover:bg-neutral-100"
          >
            {zoomPreset.label}
            <span className="text-[10px] text-neutral-400">▾</span>
          </button>
          {zoomMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setZoomMenu(false)} />
              <div
                data-timeline-zoom-menu
                role="listbox"
                className="absolute top-8 right-0 z-40 w-36 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg"
              >
                {ZOOM_PRESETS.map((preset, index) => (
                  <button
                    key={preset.key}
                    type="button"
                    role="option"
                    aria-selected={index === zoom}
                    data-timeline-zoom-option={preset.label}
                    onClick={() => {
                      changeZoom(index);
                      setZoomMenu(false);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-neutral-100 ${
                      index === zoom ? "bg-[#eff4fd] text-[#2c60b8]" : "text-neutral-700"
                    }`}
                  >
                    {preset.label}
                    {index === zoom && <span className="text-[11px]">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
        <button
          type="button"
          data-timeline-zoom-out
          aria-label="ズームアウト"
          aria-disabled={zoom === ZOOM_PRESETS.length - 1}
          title="ズームアウト"
          onClick={() => changeZoom(zoom + 1)}
          disabled={zoom === ZOOM_PRESETS.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded-md text-base text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
        >
          −
        </button>
        <button
          type="button"
          data-timeline-zoom-in
          aria-label="ズームイン"
          aria-disabled={zoom === 0}
          title="ズームイン"
          onClick={() => changeZoom(zoom - 1)}
          disabled={zoom === 0}
          className="flex h-7 w-7 items-center justify-center rounded-md text-base text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
        >
          ＋
        </button>

        <div className="relative">
          <button
            type="button"
            data-timeline-filter
            onClick={() => setMenu((m) => (m === "filter" ? null : "filter"))}
            className={menuButtonClass(filterActive, menu === "filter")}
            aria-expanded={menu === "filter"}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2.5 3h11l-4.2 5v4.2L6.7 13V8L2.5 3Z" />
            </svg>
            フィルター
            {filterActive && <span className="h-1.5 w-1.5 rounded-full bg-[#2c60b8]" />}
          </button>
          {menu === "filter" && (
            <>
              <button
                type="button"
                aria-label="メニューを閉じる"
                onClick={() => setMenu(null)}
                className="fixed inset-0 z-20 cursor-default bg-transparent"
              />
              <div
                data-timeline-filter-menu
                className="absolute right-0 top-8 z-30 w-60 rounded-lg border border-neutral-200 bg-white p-3 text-[13px] shadow-lg"
              >
                <label className="flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={hideCompleted}
                    onChange={(e) => setHideCompleted(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  完了済みを非表示
                </label>
                <div className="mt-3 text-[11px] font-medium text-neutral-500">担当者</div>
                <select
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  className="mt-1 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
                >
                  <option value="all">すべての担当者</option>
                  <option value="none">未割り当て</option>
                  {assigneeNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {(hideCompleted || assigneeFilter !== "all") && (
                  <button
                    type="button"
                    onClick={() => {
                      setHideCompleted(false);
                      setAssigneeFilter("all");
                    }}
                    className="mt-3 text-[12px] text-[#2c60b8] hover:underline"
                  >
                    フィルターを解除
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            data-timeline-sort
            onClick={() => setMenu((m) => (m === "sort" ? null : "sort"))}
            className={menuButtonClass(sortActive, menu === "sort")}
            aria-expanded={menu === "sort"}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M4 2.5v11M4 13.5 1.8 11.2M4 13.5l2.2-2.3M9 3h5M9 6.5h4M9 10h3" />
            </svg>
            ソート
            {sortActive && <span className="h-1.5 w-1.5 rounded-full bg-[#2c60b8]" />}
          </button>
          {menu === "sort" && (
            <>
              <button
                type="button"
                aria-label="メニューを閉じる"
                onClick={() => setMenu(null)}
                className="fixed inset-0 z-20 cursor-default bg-transparent"
              />
              <div
                data-timeline-sort-menu
                className="absolute right-0 top-8 z-30 w-52 rounded-lg border border-neutral-200 bg-white p-1.5 text-[13px] shadow-lg"
              >
                {(
                  [
                    ["default", "既定の並び"],
                    ["due", "期日"],
                    ["start", "開始日"],
                    ["name", "名前"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSortBy(key);
                      setMenu(null);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-neutral-100 ${
                      sortBy === key ? "text-[#2c60b8]" : "text-neutral-700"
                    }`}
                  >
                    {label}
                    {sortBy === key && (
                      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M2 6.2 4.7 9 10 3.2" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            data-timeline-options
            onClick={() => setMenu((m) => (m === "options" ? null : "options"))}
            className={menuButtonClass(optionsActive, menu === "options")}
            aria-expanded={menu === "options"}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M3 4h10M3 8h10M3 12h10" />
              <circle cx="6" cy="4" r="1.4" fill="white" />
              <circle cx="10" cy="8" r="1.4" fill="white" />
              <circle cx="7" cy="12" r="1.4" fill="white" />
            </svg>
            オプション
            {optionsActive && <span className="h-1.5 w-1.5 rounded-full bg-[#2c60b8]" />}
          </button>
          {menu === "options" && (
            <>
              <button
                type="button"
                aria-label="メニューを閉じる"
                onClick={() => setMenu(null)}
                className="fixed inset-0 z-20 cursor-default bg-transparent"
              />
              <div
                data-timeline-options-menu
                className="absolute right-0 top-8 z-30 w-56 rounded-lg border border-neutral-200 bg-white p-3 text-[13px] shadow-lg"
              >
                <label className="flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={showWeekends}
                    onChange={(e) => setShowWeekends(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  週末を網掛け
                </label>
                <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={showDependencies}
                    onChange={(e) => setShowDependencies(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  依存関係を表示
                </label>
                <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={showCritical}
                    onChange={(e) => setShowCritical(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  クリティカルパスを表示
                </label>
              </div>
            </>
          )}
        </div>
      </div>

      {tasks.length === 0 && (
        <EmptyState
          scope="timeline"
          title="タイムラインにタスクがありません"
          description="タスクを追加すると、日付に沿ってここに表示されます。"
          action={
            <button
              type="button"
              onClick={addToday}
              className="h-8 rounded-md bg-[#2c60b8] px-4 text-[13px] font-medium text-white hover:bg-[#24529c]"
            >
              ＋ 今日のタスク
            </button>
          }
        />
      )}
      <div className="flex">
        <div className="w-36 shrink-0 border-r border-[#eaeaea] md:w-60">
          <div className="h-[49px]" />
          {groups.map((group) => (
            <div key={group.section.id} className="relative" data-timeline-section={group.section.id}>
              <button
                type="button"
                data-timeline-section-row={group.section.id}
                aria-expanded={!group.collapsed}
                onClick={() => toggleSection(group.section.id)}
                className="flex h-10 w-full items-center gap-1.5 pl-5 pr-2 text-left text-[14px] font-medium text-[#050505] hover:bg-neutral-50"
              >
                <svg
                  viewBox="0 0 12 12"
                  className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${group.collapsed ? "-rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="m2.5 4.5 3.5 3 3.5-3" />
                </svg>
                <span className="truncate">{group.section.name}</span>
              </button>
              {!group.collapsed &&
                group.all
                  .slice(1)
                  .map((t) => <div key={t.id} className="h-10" data-timeline-spacer={t.id} />)}
              {group.hasDraft && <div className="h-10" />}
              <span data-timeline-group-line className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#e1e1e1]" />
            </div>
          ))}
          <button
            onClick={addSection}
            className="mt-2 ml-5 flex h-9 items-center gap-1.5 rounded px-2 text-[13px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <span className="text-[15px] leading-none">＋</span> セクションを追加
          </button>
        </div>

        <div ref={scrollRef} className="timeline-scroll min-w-0 flex-1 overflow-x-auto">
          <div
            className="relative w-full cursor-copy bg-[#f3f3f3]"
            style={{
              minWidth: Math.max(700, span * dayWidth),
              minHeight: "max(520px, calc(100vh - 178px))",
            }}
            ref={contentRef}
            data-timeline-canvas
            data-timeline-min={min}
            data-timeline-span={span}
            data-timeline-day-width={dayWidth}
            onPointerDown={() => {
              if (draftRef.current) suppressCanvasClick.current = true;
            }}
            onClick={onCanvasClick}
            onPointerMove={onCanvasMove}
            onPointerLeave={() => setHover(null)}
          >
            <div className="relative h-[49px] cursor-default border-b border-[#e1e1e1] bg-white">
              <div className="relative h-[24px] text-xs text-neutral-600">
                {axisTop.map((interval) => {
                  const widthPx = interval.daysWide * dayWidth;
                  if (widthPx < 28) return null;
                  return (
                    <span
                      key={interval.key}
                      data-timeline-axis-row="top"
                      data-timeline-axis-interval={interval.key}
                      className="absolute top-1 pl-1"
                      style={{ left: pct(interval.start) }}
                    >
                      {interval.label}
                    </span>
                  );
                })}
              </div>
              <div className="relative h-[25px] text-[11px] text-neutral-500">
                {axisBottom.map((interval) => {
                  const widthPx = interval.daysWide * dayWidth;
                  return (
                    <div
                      key={`cell-${interval.key}`}
                      data-timeline-axis-row="bottom"
                      data-timeline-axis-interval={interval.key}
                      className="absolute top-0 h-[25px] border-t border-[#eaeaea]"
                      style={{ left: pct(interval.start), width: `${interval.daysWide * dayPct}%` }}
                    >
                      {widthPx >= 28 && (
                        <span className="absolute top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                          {interval.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {showToday && (
                <span
                  className="pointer-events-none absolute z-20 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#2c60b8]"
                  style={{ left: pct(todayDay), top: 22 }}
                  title="今日"
                />
              )}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[49px] z-0">
              {showWeekends &&
                dayWidth >= 20 &&
                weekendDays.map((d) => (
                  <div
                    key={`weekend-${d}`}
                    data-timeline-weekend
                    className="absolute inset-y-0 bg-[#eaeaea]"
                    style={{ left: pct(d), width: `${dayPct}%` }}
                  />
                ))}
              {gridLines.map((d) => (
                <div
                  key={`grid-${d}`}
                  data-timeline-grid={d}
                  className="absolute inset-y-0 w-px bg-[#eaeaea]"
                  style={{ left: pct(d) }}
                />
              ))}
            </div>

            {hover && !drag && (
              <div
                data-timeline-hover
                className="pointer-events-none absolute z-[1] border-x border-[#2c60b8]/20 bg-[#2c60b8]/5"
                style={{ top: hover.top, height: hover.height, left: pct(hover.day), width: `${dayPct}%` }}
              >
                <span className="absolute left-1/2 top-2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-[#2c60b8] text-[12px] leading-none text-white shadow-sm">
                  +
                </span>
              </div>
            )}

            {groups.map((group) => (
              <div key={group.section.id} className="relative" data-timeline-group={group.section.id}>
                {(group.collapsed || group.tasks.length === 0) && <div className="h-10" />}
                {!group.collapsed && group.tasks.map((t) => renderBar(t))}
                {group.hasDraft && draft && (
                  <div className="relative h-10" data-timeline-draft>
                    <div
                      className="tl-bar absolute top-[3px] z-10 flex items-center rounded-[4px] bg-white px-2 text-[13px] text-[#050505] ring-2 ring-[#2c60b8]"
                      style={{
                        height: BAR_H,
                        left: pct(draft.day),
                        width: Math.max(220, dayWidth),
                        maxWidth: `calc(100% - ${pct(draft.day)})`,
                      }}
                    >
                      <input
                        key={draft.key}
                        ref={draftInputRef}
                        placeholder="タスク名を入力"
                        aria-label="新しいタスク名"
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            finishDraft(e.currentTarget.value);
                            e.currentTarget.blur();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            finishDraft("");
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={(e) => finishDraft(e.currentTarget.value)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="h-full w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
                      />
                    </div>
                  </div>
                )}
                <span
                  data-timeline-group-line
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-px bg-[#e1e1e1]"
                />
              </div>
            ))}

            {drag?.drop && (
              <div
                data-timeline-drop
                className="pointer-events-none absolute inset-x-0 z-[5] h-[2px] bg-[#2c60b8]"
                style={{ top: drag.drop.top - 1 }}
              >
                <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#2c60b8]" />
              </div>
            )}

            {showToday && (
              <div
                className="pointer-events-none absolute bottom-0 top-[49px] z-[3] w-[2px] bg-[#2C60B8]"
                style={{ left: pct(todayDay) }}
                title="今日"
              />
            )}
            {dependencyShapes.length > 0 && canvasWidth > 0 && (
              <svg className="pointer-events-none absolute inset-0 z-[2] h-full w-full">
                {dependencyShapes.map((shape) => {
                  const selected = hoveredDep === shape.key;
                  return (
                    <g key={shape.key} data-timeline-dependency={shape.key}>
                      <path
                        d={shape.d}
                        fill="none"
                        stroke={selected ? "#2c60b8" : "#737373"}
                        strokeWidth={selected ? 2 : 1.5}
                        strokeLinejoin="round"
                      />
                      <circle cx={shape.from.x} cy={shape.y1} r="2.5" fill={selected ? "#2c60b8" : "#737373"} />
                      <path d={shape.arrow} fill={selected ? "#2c60b8" : "#737373"} />
                      <path
                        data-timeline-dependency-hit={shape.key}
                        d={shape.d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={12}
                        strokeLinejoin="round"
                        style={{ pointerEvents: "stroke", cursor: "pointer" }}
                        tabIndex={0}
                        onPointerEnter={() => showDepHover(shape.key)}
                        onPointerLeave={scheduleDepHoverClear}
                        onFocus={() => showDepHover(shape.key)}
                        onBlur={scheduleDepHoverClear}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </g>
                  );
                })}
              </svg>
            )}
            {hoveredShape && (
              <button
                type="button"
                data-timeline-dependency-delete={hoveredShape.key}
                aria-label="依存関係を削除"
                title="依存関係を削除"
                onPointerEnter={() => showDepHover(hoveredShape.key)}
                onPointerLeave={scheduleDepHoverClear}
                onClick={(event) => {
                  event.stopPropagation();
                  void removeDependency(hoveredShape.e);
                }}
                style={{ left: hoveredShape.midX, top: hoveredShape.midY }}
                className="absolute z-[6] flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-red-600 shadow-md hover:bg-red-50"
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.5 7v4M9.5 7v4" />
                </svg>
              </button>
            )}
            {depLink && (
              <svg className="pointer-events-none absolute inset-0 z-[4] h-full w-full">
                <path
                  data-timeline-dependency-draft
                  d={`M ${depLink.x1} ${depLink.y1} L ${depLink.x2} ${depLink.y2}`}
                  fill="none"
                  stroke="#2c60b8"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                />
                <circle cx={depLink.x1} cy={depLink.y1} r="3" fill="#2c60b8" />
              </svg>
            )}
          </div>
        </div>

        {undatedOpen && (
          <aside
            data-timeline-drawer
            className="sticky top-0 min-h-[calc(100vh-220px)] max-h-[calc(100vh-220px)] w-[340px] shrink-0 overflow-y-auto border-l border-neutral-200 bg-white"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <h2 className="text-[15px] font-semibold">日付なしのタスク</h2>
              <button
                type="button"
                onClick={() => setUndatedOpen(false)}
                className="text-xl leading-none text-neutral-400 hover:text-neutral-700"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <div className="p-3">
              {undated.length === 0 ? (
                <p className="text-sm text-neutral-500">日付なしのタスクはありません。</p>
              ) : (
                undated.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openTask(t.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-neutral-900 ${avatarColor(t.assignee_name)}`}>
                      {(t.assignee_name ?? "?").slice(0, 1)}
                    </span>
                    <span title={t.name} dir="auto" className="min-w-0 flex-1 truncate">{t.name}</span>
                  </button>
                ))
              )}
              <div className="mt-4 border-t border-neutral-100 pt-3 text-xs font-medium text-neutral-500">
                このプロジェクト内のタスク
              </div>
              {visibleTasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTask(t.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-neutral-100"
                >
                  <span title={t.name} dir="auto" className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-[11px] text-neutral-400">{t.due_on ?? "—"}</span>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
