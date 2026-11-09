"use client";

import { toast as toastMessage } from "@/lib/ui-feedback";

import { ApiError, api } from "@/lib/api-client";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskRow, User } from "@/lib/data";
import { dayDeltaFromPixels, shiftDate } from "@/lib/timeline-dnd";
import { criticalPath } from "@/lib/critical-path";
import { formatDay } from "@/lib/calendar";
import EmptyState from "./EmptyState";
import TaskAvatar from "./task/TaskAvatar";
import TimelineBar from "./timeline/TimelineBar";
import TimelineAxis from "./timeline/TimelineAxis";
import TimelineCanvas from "./timeline/TimelineCanvas";
import TimelineDependencyLayer from "./timeline/TimelineDependencyLayer";
import TimelineToolbar from "./timeline/TimelineToolbar";
import { usePersistedViewState } from "@/lib/view-state-client";
import { dayOrNull } from "@/lib/task-dates";
import { isSingleDayTimelineTask, usesTimelineExternalLabel } from "@/lib/timeline-marker";
import { assignTimelineLanes, estimateTimelineLabelDays, timelineInterval } from "@/lib/timeline-lanes";
import { timelineBarDragStyle } from "@/lib/timeline-drag-style";
import { useTimelineFilters } from "@/lib/use-timeline-filters";
import { useTimelineViewport, ZOOM_PRESETS } from "@/lib/use-timeline-viewport";

const toDay = dayOrNull;

// Asana-measured timeline metrics (REA, 2026-11-06):
// row pitch 40px, bar 34px + 4px radius, axis 49px (month + week rows),
// section header shares the first 40px task row, group hairlines #e1e1e1,
// daily grid #eaeaea, weekend stripes #eaeaea, 2px today stripe, 10px resize handles.
const ROW_PITCH = 40;
const BAR_H = 34;
const AXIS_H = 49;
const EDGE_HIT = 10;
type Draft = { sectionId: number | null; day: number; key: number } | null;


export default function TimelineView({
  projectId,
  sections,
  tasks,
  deps,
  startOverride,
  initialState,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
  users,
  viewerId,
  statusFieldName,
  statusFieldEnabled,
  statusOptions,
}: {
  projectId: number;
  sections: Section[];
  tasks: TaskRow[];
  deps: { task_id: number; depends_on_id: number }[];
  startOverride: number | null;
  initialState?: Record<string, string | number | boolean | null>;
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
  users: User[];
  viewerId: number;
  statusFieldName: string;
  statusFieldEnabled: boolean;
  statusOptions: string[];
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
  const {
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
  } = useTimelineFilters({ tasks, initialState, viewerId, statusFieldEnabled });

  const {
    zoom,
    zoomPreset,
    dayWidth,
    min,
    max,
    span,
    dayPct,
    pct,
    changeZoom,
    todayDay,
    showToday,
    weekendDays,
    axisTop,
    axisBottom,
    gridLines,
  } = useTimelineViewport({
    dated,
    startOverride,
    initialZoom: typeof stored.zoom === "number" ? stored.zoom : 2,
    scrollRef,
    contentRef,
  });

  const [undatedOpen, setUndatedOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [collapsedHydrated, setCollapsedHydrated] = useState(false);
  const [draft, setDraft] = useState<Draft>(null);
  const [zoomMenu, setZoomMenu] = useState(false);
  const [showWeekends, setShowWeekends] = useState(stored.weekends !== false);
  const [showDependencies, setShowDependencies] = useState(stored.dependencies !== false);
  const [showCritical, setShowCritical] = useState(stored.critical !== false);
  usePersistedViewState(projectId, "timeline", {
    zoom,
    ...persistedState,
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
  const longPressTimer = useRef<number | null>(null);
  const depHoverTimer = useRef<number | null>(null);
  const [drag, setDrag] = useState<{
    id: number;
    mode: "move" | "start" | "end";
    axis: "x" | "row" | null;
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    rowDrop: { sectionId: number; row: number; top: number } | null;
  } | null>(null);

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

  const groups = useMemo(() => {
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
        else if (sortBy === "assignee") sorted.sort((a, b) => (a.assignee_name ?? "").localeCompare(b.assignee_name ?? "", "ja") || a.id - b.id);
        bySection.set(key, sorted);
      }
    }

    // Section groups carry absolute offsets so a click anywhere in the canvas
    // can resolve section + date, like Asana's timeline canvas.
    let cursorY = AXIS_H;
    const out: {
      section: Section;
      tasks: TaskRow[];
      all: TaskRow[];
      collapsed: boolean;
      hasDraft: boolean;
      top: number;
      height: number;
      laneById: Map<number, number>;
      laneCount: number;
      overlappingIds: Set<number>;
    }[] = [];
    for (const section of sections) {
      const all = bySection.get(section.id) ?? [];
      const isCollapsed = collapsed.has(section.id);
      const hasDraft = !isCollapsed && draft?.sectionId === section.id;
      const shown = isCollapsed ? [] : all;
      const laneIntervals = shown
        .map((task) => {
          const interval = timelineInterval(task);
          if (!interval) return null;
          const barDays = interval.end - interval.start + 1;
          const barPx = barDays * dayWidth;
          const externalLabel = usesTimelineExternalLabel(task, barPx, dayWidth);
          const visualEnd = externalLabel
            ? interval.end + estimateTimelineLabelDays(task.name, dayWidth)
            : undefined;
          return {
            id: task.id,
            ...interval,
            visualEnd,
            pinnedRow: task.timeline_row ?? null,
          };
        })
        .filter(
          (interval): interval is {
            id: number;
            start: number;
            end: number;
            visualEnd: number | undefined;
            pinnedRow: number | null;
          } => interval !== null,
        );
      const { laneById, laneCount, overlappingIds } = assignTimelineLanes(laneIntervals);
      const lanes = Math.max(1, laneCount);
      // The section header shares the first lane; each additional lane adds a row.
      const height = isCollapsed
        ? ROW_PITCH
        : lanes * ROW_PITCH + (hasDraft ? ROW_PITCH : 0);
      out.push({
        section,
        tasks: shown,
        all,
        collapsed: isCollapsed,
        hasDraft,
        top: cursorY,
        height,
        laneById,
        laneCount: lanes,
        overlappingIds,
      });
      cursorY += height;
    }
    return out;
  }, [dated, sections, sortBy, collapsed, draft, dayWidth]);

  // Absolute y centers for dependency edges (axis + headers + task rows).
  const { rowY, pos } = useMemo(() => {
    const rowY = new Map<number, number>();
    const pos = new Map<number, { x1: string; x2: string }>();
    for (const group of groups) {
      for (const t of group.tasks) {
        const milestoneDay = t.is_milestone ? (toDay(t.due_on) ?? toDay(t.start_on)) : null;
        const st = milestoneDay ?? toDay(t.start_on) ?? toDay(t.due_on)!;
        const en = milestoneDay ?? toDay(t.due_on) ?? toDay(t.start_on)!;
        rowY.set(
          t.id,
          group.top + (group.laneById.get(t.id) ?? 0) * ROW_PITCH + ROW_PITCH / 2,
        );
        pos.set(t.id, { x1: pct(Math.max(st, min)), x2: pct(Math.min(en, max) + 1) });
      }
    }
    return { rowY, pos };
  }, [groups, min, max, pct]);
  const edges = useMemo(
    () => (showDependencies ? deps.filter((d) => rowY.has(d.task_id) && rowY.has(d.depends_on_id)) : []),
    [showDependencies, deps, rowY],
  );
  const dependencyShapes = useMemo(
    () =>
      edges.map((e) => {
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
      }),
    [edges, pos, rowY, canvasWidth],
  );
  // Asana marks each milestone with a green stripe through the whole canvas.
  const milestoneLines = useMemo(() => {
    const offset = Math.min(8, dayWidth / 2);
    const lines: { id: number; left: string }[] = [];
    for (const group of groups) {
      if (group.collapsed) continue;
      for (const t of group.tasks) {
        if (!t.is_milestone) continue;
        const p = pos.get(t.id);
        if (!p) continue;
        lines.push({ id: t.id, left: `calc(${p.x1} + ${offset}px)` });
      }
    }
    return lines;
  }, [groups, pos, dayWidth]);
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
  const critical = useMemo(
    () =>
      showCritical
        ? criticalPath(
            dated.map((t) => ({ id: t.id, start_on: t.start_on, due_on: t.due_on })),
            deps,
          )
        : new Set<number>(),
    [showCritical, dated, deps],
  );

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
    try {
      await patchTask(
        t.id,
        {
          ...(nextStart !== null ? { start_on: nextStart } : {}),
          ...(nextEnd !== null ? { due_on: nextEnd } : {}),
          ...extra,
        },
        t.updated_at,
      );
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      } else {
        toastMessage(`変更に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
    }
    refresh();
  };

  const toggleComplete = async (t: TaskRow) => {
    try {
      await patchTask(
        t.id,
        { completed: !t.completed, progress: t.completed ? t.progress : 100 },
        t.updated_at,
      );
    } catch (error) {
      if (error instanceof TaskConflictError) toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      else toastMessage(`更新に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
    }
    refresh();
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
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (e.pointerType === "touch" && mode === "move") {
      longPressTimer.current = window.setTimeout(() => {
        setDrag((prev) => (prev && prev.axis === null ? { ...prev, axis: "row" } : prev));
        longPressTimer.current = null;
      }, 300);
    }
    setDrag({
      id: t.id,
      mode,
      axis: null,
      dx: 0,
      dy: 0,
      startX: e.clientX,
      startY: e.clientY,
      rowDrop: null,
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
    let axis = drag.axis;
    if (axis === null && Math.max(Math.abs(dx), Math.abs(dy)) > 6) {
      axis =
        drag.mode === "move" && canEdit && Math.abs(dy) > Math.abs(dx)
          ? "row"
          : "x";
    }
    if (axis !== null && longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (axis === "row") {
      const group = groups.find((entry) => entry.tasks.some((task) => task.id === drag.id));
      const rect = contentRef.current?.getBoundingClientRect();
      if (!group || !rect) {
        setDrag({ ...drag, axis, dx: 0, dy, rowDrop: null });
        return;
      }
      const y = e.clientY - rect.top;
      const row = Math.max(
        0,
        Math.min(group.laneCount, Math.floor((y - group.top) / ROW_PITCH)),
      );
      setDrag({
        ...drag,
        axis,
        dx: 0,
        dy,
        rowDrop: { sectionId: group.section.id, row, top: group.top + row * ROW_PITCH },
      });
      return;
    }
    setDrag({ ...drag, axis, dx, dy, rowDrop: null });
  };
  const onBarUp = async () => {
    if (!drag) return;
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    const d = drag;
    setDrag(null);
    if (d.axis === "row") {
      if (!d.rowDrop) return;
      const target = tasks.find((x) => x.id === d.id);
      if (target) await setTimelineRow(target, d.rowDrop.row);
      return;
    }
    if (d.axis !== "x") return;
    const el = contentRef.current;
    if (!el) {
      refresh();
      return;
    }
    const t = tasks.find((x) => x.id === d.id);
    if (!t) return;
    const delta = dayDeltaFromPixels(d.dx, el.getBoundingClientRect().width, span);
    await commitChange(t, delta, d.mode);
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
      if (res.status === 409) toastMessage("循環依存は作成できません");
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

  const linkDay = (d: number) => formatDay(d);

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
        toastMessage(`作成に失敗しました: ${res.status}`);
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
    if (t.is_milestone) return "bg-white text-[#050505] shadow-[0_0_0_1px_#eaeaea,0_1px_4px_rgba(118,118,118,0.08)]";
    if (t.completed) return "bg-[#aaaaaa] text-[#050505]";
    if (showCritical && critical.has(t.id)) return "bg-red-200 text-neutral-900";
    return "bg-white text-[#050505] shadow-[0_0_0_1px_#eaeaea,0_1px_4px_rgba(118,118,118,0.08)]";
  };

  const barPxFor = (t: TaskRow) => {
    if (t.is_milestone) return dayWidth;
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
    return {
      ...style,
      ...timelineBarDragStyle({
        mode: d.mode,
        axis: d.axis,
        dx: d.dx,
        dy: d.dy,
        x1: p.x1,
        x2: p.x2,
        canReorder,
      }),
    };
  };

  const handleStyle = (t: TaskRow, edge: "start" | "end"): React.CSSProperties => {
    const p = pos.get(t.id)!;
    const d = drag && drag.id === t.id ? drag : null;
    const sameDay = isSingleDayTimelineTask(t);
    const hit = edgeHitFor(sameDay && barHoverId !== t.id ? 8 : barPxFor(t));
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

  const setTimelineRow = async (t: TaskRow, rowIndex: number) => {
    if (!canEdit) return;
    const current = t.timeline_row ?? null;
    if (current === rowIndex) return;
    try {
      await api(`/api/tasks/${t.id}/timeline-row`, "PUT", {
        project_id: projectId,
        row_index: rowIndex,
        ...(t.timeline_row_updated_at
          ? { expected_updated_at: t.timeline_row_updated_at }
          : {}),
      });
      toastMessage("行を移動しました");
      refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
        refresh();
      } else {
        toastMessage(error instanceof Error ? error.message : "行の移動に失敗しました");
      }
    }
  };

  const moveTimelineRow = (t: TaskRow, delta: number) => {
    if (!canEdit) return;
    const group = groups.find((entry) => entry.tasks.some((task) => task.id === t.id));
    const current = t.timeline_row ?? group?.laneById.get(t.id) ?? 0;
    const next = Math.max(0, Math.min(200, current + delta));
    void setTimelineRow(t, next);
  };

  const renderBar = (t: TaskRow, lane: number, overlapping: boolean) => {
    const dx = dragDelta(t.id);
    const active = drag?.id === t.id;
    const barPx = barPxFor(t);
    const showAvatar = Boolean(t.assignee_name) && barPx >= 140;
    const showSubtasks = t.subtask_count > 0 && barPx >= 160;
    const p = pos.get(t.id)!;
    const leftPct = parseFloat(p.x1);
    const sameDay = isSingleDayTimelineTask(t);
    const skinny = barPx < 52;
    const externalLabel = usesTimelineExternalLabel(t, barPx, dayWidth);
    const labelOnLeft = leftPct > 72;
    const barInfo = `${t.name}（${t.start_on ?? "?"} 〜 ${t.due_on ?? "?"}・進捗${t.progress}%${t.assignee_name ? `・担当${t.assignee_name}` : ""}${t.timeline_row !== null && t.timeline_row !== undefined ? "・行固定" : ""}）${!t.completed && showCritical && critical.has(t.id) ? "【クリティカルパス】" : ""} — 左右で日付移動、上下で行移動、左右端で期間変更、Alt+上下で行移動`;
    return (
      <TimelineBar
        key={t.id}
        task={t}
        lane={lane}
        rowLocked={t.timeline_row !== null && t.timeline_row !== undefined}
        overlapping={overlapping}
        externalLabel={externalLabel}
        onMoveRow={(delta) => moveTimelineRow(t, delta)}
        x1={p.x1}
        x2={p.x2}
        skinny={skinny}
        sameDay={sameDay}
        labelOnLeft={labelOnLeft}
        active={active}
        dragMode={drag?.mode ?? null}
        dx={dx}
        hovered={barHoverId === t.id}
        overflow={barOverflowId === t.id}
        dependencyTarget={depTargetId === t.id}
        showAvatar={showAvatar}
        showSubtasks={showSubtasks}
        barFaceClass={barFace(t)}
        barStyle={barStyle(t)}
        startHandleStyle={handleStyle(t, "start")}
        endHandleStyle={handleStyle(t, "end")}
        activeGuideLeft={
          active && drag?.mode !== "move"
            ? handleStyle(t, drag.mode === "start" ? "start" : "end").left
            : undefined
        }
        barInfo={barInfo}
        onBarPointerDown={(event) => beginBarDrag(event, t)}
        onBarPointerMove={onBarMove}
        onBarPointerUp={onBarUp}
        onBarClick={(event) => {
          event.stopPropagation();
          if (!moved.current) openTask(t.id);
        }}
        onBarEnter={() => showBarHover(t.id)}
        onBarLeave={scheduleBarHoverClear}
        onStartDrag={(event) => beginDrag(event, t, "start")}
        onEndDrag={(event) => beginDrag(event, t, "end")}
        onStartDependency={(event) => beginDependency(event, t, "start")}
        onEndDependency={(event) => beginDependency(event, t, "end")}
        onDependencyUp={(event) => void endDependency(event)}
        onDependencyMove={moveDependency}
        onDependencyEnter={() => showBarHover(t.id)}
        onDependencyLeave={scheduleBarHoverClear}
        onToggleComplete={() => toggleComplete(t)}
      />
    );
  };

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
      data-timeline-completed-only={completedOnly}
      data-timeline-mine-only={mineOnly}
      data-timeline-status={statusFilter}
      data-timeline-due={dueFilter}
      data-timeline-start={startFilter}
      data-timeline-creator={creatorFilter}
      data-timeline-created={createdFilter}
      data-timeline-updated={updatedFilter}
      data-timeline-completed-on={completedDateFilter}
    >
      <TimelineToolbar
        projectId={projectId}
        min={min}
        linkDay={linkDay}
        addToday={addToday}
        undatedCount={undated.length}
        undatedOpen={undatedOpen}
        setUndatedOpen={setUndatedOpen}
        zoom={zoom}
        zoomPreset={zoomPreset}
        zoomPresets={ZOOM_PRESETS}
        zoomMenu={zoomMenu}
        setZoomMenu={setZoomMenu}
        changeZoom={changeZoom}
        filters={filters}
        activeFilterCount={activeFilterCount}
        onFilterChange={setTimelineFilter}
        clearFilters={clearTimelineFilters}
        sortBy={sortBy}
        setSortBy={setSortBy}
        users={users}
        statusFieldName={statusFieldName}
        statusFieldEnabled={statusFieldEnabled}
        statusOptions={statusOptions}
        sections={sections}
        viewName={viewName}
        viewIcon={viewIcon}
        viewTabId={viewTabId}
        canEdit={canEdit}
        showWeekends={showWeekends}
        setShowWeekends={setShowWeekends}
        showDependencies={showDependencies}
        setShowDependencies={setShowDependencies}
        showCritical={showCritical}
        setShowCritical={setShowCritical}
      />
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
                Array.from({ length: Math.max(0, group.laneCount - 1) }).map((_, index) => (
                  <div
                    key={`lane-${index}`}
                    className="h-10"
                    data-timeline-lane-spacer={`${group.section.id}-${index}`}
                  />
                ))}
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

        <TimelineCanvas
          scrollRef={scrollRef}
          contentRef={contentRef}
          min={min}
          span={span}
          dayWidth={dayWidth}
          onPointerDown={() => {
            if (draftRef.current) suppressCanvasClick.current = true;
          }}
          onClick={onCanvasClick}
          onPointerMove={onCanvasMove}
          onPointerLeave={() => setHover(null)}
        >
            <TimelineAxis
              axisTop={axisTop}
              axisBottom={axisBottom}
              weekendDays={weekendDays}
              gridLines={gridLines}
              showWeekends={showWeekends}
              showToday={showToday}
              todayDay={todayDay}
              pct={pct}
              dayPct={dayPct}
              dayWidth={dayWidth}
            />

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

            {milestoneLines.map((line) => (
              <div
                key={`milestone-line-${line.id}`}
                data-timeline-milestone-line={line.id}
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 top-0 z-[2] w-0.5 bg-[#46a75a] opacity-20"
                style={{ left: line.left }}
              />
            ))}

            {groups.map((group) => (
              <div
                key={group.section.id}
                className="relative"
                style={{ height: group.height }}
                data-timeline-group={group.section.id}
              >
                {!group.collapsed &&
                  group.tasks.map((t) => {
                    const lane = group.laneById.get(t.id) ?? 0;
                    return (
                      <div
                        key={t.id}
                        className="absolute inset-x-0"
                        style={{ top: lane * ROW_PITCH, height: ROW_PITCH }}
                      >
                        {renderBar(t, lane, group.overlappingIds.has(t.id))}
                      </div>
                    );
                  })}
                {group.hasDraft && draft && (
                  <div
                    className="absolute inset-x-0 h-10"
                    style={{ top: group.laneCount * ROW_PITCH }}
                    data-timeline-draft
                  >
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

            {drag?.rowDrop && (
              <div
                data-timeline-row-drop
                data-timeline-row-drop-index={drag.rowDrop.row}
                className="pointer-events-none absolute inset-x-0 z-[5] h-[2px] bg-[#2c60b8]"
                style={{ top: drag.rowDrop.top - 1 }}
              >
                <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#2c60b8]" />
                <span className="absolute left-2 -top-2 rounded bg-[#2c60b8] px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
                  行 {drag.rowDrop.row + 1}
                </span>
              </div>
            )}

            {showToday && (
              <div
                className="pointer-events-none absolute bottom-0 top-[49px] z-[3] w-[2px] bg-[#2C60B8]"
                style={{ left: pct(todayDay) }}
                title="今日"
              />
            )}
            <TimelineDependencyLayer
              shapes={dependencyShapes}
              hoveredKey={hoveredDep}
              draft={depLink}
              onHover={showDepHover}
              onLeave={scheduleDepHoverClear}
              onDelete={removeDependency}
            />
        </TimelineCanvas>

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
                    <TaskAvatar name={t.assignee_name ?? "?"} className="h-6 w-6" />
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