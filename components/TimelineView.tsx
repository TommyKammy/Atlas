"use client";

import { toast as toastMessage } from "@/lib/ui-feedback";

import { ApiError, api } from "@/lib/api-client";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Section, User } from "@/lib/data";
import { decodeTimelineTask, type TaskTimelineRow, type TimelineTaskPayload } from "@/lib/timeline-task-payload";
import { shiftDate } from "@/lib/timeline-dnd";
import { formatDay } from "@/lib/calendar";
import EmptyState from "./EmptyState";
import ProjectTaskContextMenu from "./task/ProjectTaskContextMenu";
import TaskAvatar from "./task/TaskAvatar";
import TimelineBar from "./timeline/TimelineBar";
import TimelineAxis from "./timeline/TimelineAxis";
import TimelineCanvas from "./timeline/TimelineCanvas";
import TimelineDependencyLayer from "./timeline/TimelineDependencyLayer";
import TimelineToolbar from "./timeline/TimelineToolbar";
import { usePersistedViewState } from "@/lib/view-state-client";
import { timelineInterval } from "@/lib/timeline-lanes";
import { clampTimelineDay } from "@/lib/timeline-axis";
import { useTimelineFilters } from "@/lib/use-timeline-filters";
import { useTimelineDependencies } from "@/lib/use-timeline-dependencies";
import { useTimelineDrag } from "@/lib/use-timeline-drag";
import { useTimelineDraft } from "@/lib/use-timeline-draft";
import { useTimelineHover } from "@/lib/use-timeline-hover";
import { useTimelineLayout } from "@/lib/use-timeline-layout";
import { isTimelineBarInWindow, useTimelineRenderWindow } from "@/lib/use-timeline-render-window";
import { useTimelineViewport, ZOOM_PRESETS } from "@/lib/use-timeline-viewport";
import {
  TIMELINE_AXIS_HEIGHT as AXIS_H,
  TIMELINE_BAR_HEIGHT as BAR_H,
  TIMELINE_ROW_PITCH as ROW_PITCH,
} from "@/lib/timeline-metrics";

const WINDOWED_TIMELINE_TASKS = 2_000;

// Keep the task's place in tab order while its visual bar is outside the window.
const TimelineBarPlaceholder = memo(function TimelineBarPlaceholder({
  id, name, left, top, onFocus,
}: {
  id: number;
  name: string;
  left: string;
  top: number;
  onFocus: (id: number) => void;
}) {
  return (
    <button
      type="button"
      data-timeline-focus-placeholder={id}
      aria-label={name}
      className="pointer-events-none absolute h-px w-px opacity-0"
      style={{ left, top }}
      onFocus={() => onFocus(id)}
    />
  );
});

export default function TimelineView({
  projectId,
  sections,
  taskPayload,
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
  taskPayload: TimelineTaskPayload[];
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
  const tasks = useMemo(() => taskPayload.map(decodeTimelineTask), [taskPayload]);
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const suppressCanvasClick = useRef(false);
  const [revealBarId, setRevealBarId] = useState<number | null>(null);
  const [focusedBarId, setFocusedBarId] = useState<number | null>(null);
  const pendingBarFocus = useRef<number | null>(null);
  const {
    depLink,
    depTargetId,
    hoveredDep,
    beginDependency,
    moveDependency,
    endDependency,
    cancelDependency,
    removeDependency,
    showDepHover,
    scheduleDepHoverClear,
  } = useTimelineDependencies({ contentRef, scrollRef, refresh });
  const {
    hover,
    setHover,
    barHoverId,
    barOverflowId,
    showBarHover,
    scheduleBarHoverClear,
    clearBarHover,
  } = useTimelineHover();

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
    navigationDays,
    pct,
    changeZoom,
    anchorDay,
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
  const renderWindow = useTimelineRenderWindow({
    enabled: dated.length > WINDOWED_TIMELINE_TASKS,
    scrollRef,
    contentRef,
    min,
    span,
    dayWidth,
    anchorDay,
  });
  const focusPlaceholder = useCallback((id: number) => {
    pendingBarFocus.current = id;
    setFocusedBarId(id);
  }, []);

  useLayoutEffect(() => {
    if (focusedBarId === null || pendingBarFocus.current !== focusedBarId) return;
    const bar = contentRef.current?.querySelector<HTMLElement>(`[data-timeline-bar="${focusedBarId}"]`);
    if (!bar) return;
    pendingBarFocus.current = null;
    bar.focus({ preventScroll: true });
    bar.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusedBarId]);

  const [undatedOpen, setUndatedOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [collapsedHydrated, setCollapsedHydrated] = useState(false);
  const [zoomMenu, setZoomMenu] = useState(false);
  const [showWeekends, setShowWeekends] = useState(stored.weekends !== false);
  const [showDependencies, setShowDependencies] = useState(stored.dependencies !== false);
  const [showCritical, setShowCritical] = useState(stored.critical !== false);
  const viewState = useMemo(() => ({
    zoom,
    ...persistedState,
    weekends: showWeekends,
    dependencies: showDependencies,
    critical: showCritical,
  }), [zoom, persistedState, showWeekends, showDependencies, showCritical]);
  usePersistedViewState(projectId, "timeline", viewState);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const {
    draft,
    draftInputRef,
    draftRef,
    openDraft: openDraftBase,
    finishDraft,
  } = useTimelineDraft({
    projectId,
    refresh,
    expandSection: (sectionId) => {
      if (sectionId === null) return;
      setCollapsed((prev) => {
        if (!prev.has(sectionId)) return prev;
        const next = new Set(prev);
        next.delete(sectionId);
        return next;
      });
    },
    onCreated: setRevealBarId,
  });

  const openDraft = (sectionId: number | null, day: number) => {
    openDraftBase(sectionId, day);
    setHover(null);
  };

  useEffect(() => {
    if (revealBarId === null) return;
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-timeline-bar="${revealBarId}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      // Clear the temporary render priority once the new bar is on screen.
      const frame = window.requestAnimationFrame(() => setRevealBarId(null));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [revealBarId, tasks]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setCanvasWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const windowedTasks = useMemo(() => dated.filter((task) => {
    const days = timelineInterval(task);
    return days !== null && days.start <= max && days.end >= min;
  }), [dated, min, max]);

  const { groups, pos, dependencyShapes, milestoneLines, critical } = useTimelineLayout({
    dated: windowedTasks,
    sections,
    sortBy,
    collapsed,
    draft,
    dayWidth,
    showDependencies,
    deps,
    canvasWidth,
    pct,
    min,
    max,
    showCritical,
  });
  const commitChange = useCallback(async (
    t: TaskTimelineRow,
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
  }, [refresh]);

  const toggleComplete = useCallback(async (t: TaskTimelineRow) => {
    if (t.approval) {
      const q = new URLSearchParams(window.location.search);
      q.set("task", String(t.id));
      q.set("approval", "1");
      router.push(`/projects/${projectId}?${q.toString()}`);
      return;
    }
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
  }, [projectId, refresh, router]);

  const linkDay = (d: number) => formatDay(clampTimelineDay(d));

  const openTask = useCallback((id: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set("task", String(id));
    router.push(`/projects/${projectId}?${q.toString()}`);
  }, [projectId, router]);

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

  const setTimelineRow = useCallback(async (t: TaskTimelineRow, rowIndex: number) => {
    if (!canEdit) return;
    const current = t.timeline_row ?? null;
    if (current === rowIndex) return;
    try {
      await api(`/api/tasks/${t.id}/timeline-row`, "PUT", {
        project_id: projectId,
        row_index: rowIndex,
        expected_updated_at: t.timeline_row_updated_at ?? null,
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
  }, [canEdit, projectId, refresh]);

  const onDragStart = useCallback(() => {
    setHover(null);
    clearBarHover();
  }, [clearBarHover, setHover]);

  const {
    drag,
    moved,
    beginDrag,
    beginBarDrag,
    onBarMove,
    onBarUp,
    onBarCancel,
  } = useTimelineDrag({
    contentRef,
    scrollRef,
    groups,
    tasks,
    span,
    canEdit,
    onDragStart,
    onCommit: commitChange,
    onRowDrop: setTimelineRow,
  });

  const moveTimelineRow = useCallback((t: TaskTimelineRow, delta: number) => {
    if (!canEdit) return;
    const group = groups.find((entry) => entry.tasks.some((task) => task.id === t.id));
    const current = t.timeline_row ?? group?.laneById.get(t.id) ?? 0;
    const next = Math.max(0, Math.min(200, current + delta));
    void setTimelineRow(t, next);
  }, [canEdit, groups, setTimelineRow]);

  const onBarClick = useCallback((event: React.MouseEvent<HTMLDivElement>, id: number) => {
    event.stopPropagation();
    if (!moved.current) openTask(id);
  }, [moved, openTask]);

  const renderBar = (t: TaskTimelineRow, lane: number, overlapping: boolean) => {
    const p = pos.get(t.id)!;
    return (
      <TimelineBar
        key={t.id}
        task={t}
        lane={lane}
        overlapping={overlapping}
        onMoveRow={moveTimelineRow}
        x1={p.x1}
        x2={p.x2}
        min={min}
        max={max}
        dayWidth={dayWidth}
        critical={showCritical && critical.has(t.id)}
        drag={drag?.id === t.id ? drag : null}
        canReorder={canReorder}
        hovered={barHoverId === t.id}
        overflow={barOverflowId === t.id}
        dependencyTarget={depTargetId === t.id}
        onBarPointerDown={beginBarDrag}
        onResizeStart={beginDrag}
        onBarPointerMove={onBarMove}
        onBarPointerUp={onBarUp}
        onBarPointerCancel={onBarCancel}
        onBarClick={onBarClick}
        onBarEnter={showBarHover}
        onBarLeave={scheduleBarHoverClear}
        onDependencyStart={beginDependency}
        onDependencyUp={endDependency}
        onDependencyMove={moveDependency}
        onDependencyCancel={cancelDependency}
        onToggleComplete={toggleComplete}
      />
    );
  };

  return (
    <div
      className="pb-16 text-sm"
      data-timeline
      data-timeline-windowed={renderWindow ? "true" : undefined}
      onFocusCapture={renderWindow ? (event) => {
        const row = (event.target as HTMLElement).closest("[data-timeline-row]");
        if (row) setFocusedBarId(Number(row.getAttribute("data-timeline-row")));
      } : undefined}
      onBlurCapture={renderWindow ? (event) => {
        if (pendingBarFocus.current !== null) return;
        const next = event.relatedTarget;
        if (!(next instanceof Element) || !next.closest("[data-timeline-row], [data-task-context-menu]")) {
          setFocusedBarId(null);
        }
      } : undefined}
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
        navigationDays={navigationDays}
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
                    const top = lane * ROW_PITCH;
                    const position = pos.get(t.id)!;
                    const keepMounted = t.id === focusedBarId || t.id === revealBarId ||
                      t.id === drag?.id || t.id === depLink?.fromId || t.id === depTargetId;
                    if (renderWindow && !keepMounted &&
                        !isTimelineBarInWindow(renderWindow, position, group.top + top, ROW_PITCH)) {
                      return (
                        <TimelineBarPlaceholder
                          key={t.id}
                          id={t.id}
                          name={t.name}
                          left={position.x1}
                          top={top + 3}
                          onFocus={focusPlaceholder}
                        />
                      );
                    }
                    return (
                      <div
                        key={t.id}
                        className="absolute inset-x-0"
                        style={{ top, height: ROW_PITCH }}
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
      <ProjectTaskContextMenu projectId={projectId} tasks={tasks} canEdit={canEdit} />
    </div>
  );
}
