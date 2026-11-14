"use client";

import { useMemo } from "react";
import type { Section } from "./data";
import type { TaskTimelineRow } from "./timeline-task-payload";
import { estimateTimelineLabelDays, assignTimelineLanes, timelineInterval } from "./timeline-lanes";
import { usesTimelineExternalLabel } from "./timeline-marker";
import { dayOrNull } from "./task-dates";
import { taskSectionId } from "./task-section";
import { TIMELINE_AXIS_HEIGHT, TIMELINE_ROW_PITCH } from "./timeline-metrics";
import type { TimelineSortKey } from "./use-timeline-filters";

export type TimelineDraftPosition = { sectionId: number | null; lane: number } | null;

export type TimelineGroup = {
  section: Section;
  /** The display-only section key 0 represents the nullable project section. */
  sectionId: number | null;
  tasks: TaskTimelineRow[];
  all: TaskTimelineRow[];
  collapsed: boolean;
  hasDraft: boolean;
  top: number;
  height: number;
  laneById: Map<number, number>;
  laneCount: number;
  overlappingIds: Set<number>;
  occupantsByLane: Map<number, number[]>;
  intervalsById: Map<number, { start: number; end: number }>;
};

export type TimelineDependencyShape = {
  e: { task_id: number; depends_on_id: number };
  key: string;
  d: string;
  arrow: string;
  from: { x: number };
  to: { x: number };
  y1: number;
  y2: number;
  midX: number;
  midY: number;
};

/**
 * Vertical timeline layout: section groups, lanes, absolute row positions,
 * dependency edges and milestone lines. Pure derived state only; drag and
 * filter state stay in their own hooks.
 */
export function useTimelineLayout({
  dated,
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
}: {
  dated: TaskTimelineRow[];
  sections: Section[];
  sortBy: TimelineSortKey;
  collapsed: Set<number>;
  draft: TimelineDraftPosition;
  dayWidth: number;
  showDependencies: boolean;
  deps: { task_id: number; depends_on_id: number }[];
  canvasWidth: number;
  pct: (day: number) => string;
  min: number;
  max: number;
}) {
  const groups = useMemo<TimelineGroup[]>(() => {
    const sectionIds = new Set(sections.map((section) => section.id));
    const bySection = new Map<number | null, TaskTimelineRow[]>();
    for (const t of dated) {
      const rawSection = taskSectionId(t);
      const k = rawSection !== null && sectionIds.has(rawSection) ? rawSection : null;
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
    let cursorY = TIMELINE_AXIS_HEIGHT;
    const out: TimelineGroup[] = [];
    const displaySections = [...sections, { id: 0, name: "セクションなし", position: Infinity }];
    for (const section of displaySections) {
      const sectionId = section.id === 0 ? null : section.id;
      const all = bySection.get(sectionId) ?? [];
      const isCollapsed = collapsed.has(section.id);
      const hasDraft = !isCollapsed && draft?.sectionId === sectionId;
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
        ? TIMELINE_ROW_PITCH
        : lanes * TIMELINE_ROW_PITCH;
      const occupantsByLane = new Map<number, number[]>();
      for (const [id, lane] of laneById) {
        const occupants = occupantsByLane.get(lane) ?? [];
        occupants.push(id);
        occupantsByLane.set(lane, occupants);
      }
      out.push({
        section,
        sectionId,
        tasks: shown,
        all,
        collapsed: isCollapsed,
        hasDraft,
        top: cursorY,
        height,
        laneById,
        laneCount: lanes,
        overlappingIds,
        occupantsByLane,
        intervalsById: new Map(laneIntervals.map((item) => [item.id, { start: item.start, end: Math.max(item.end, item.visualEnd ?? item.end) }])),
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
        const milestoneDay = t.is_milestone ? (dayOrNull(t.due_on) ?? dayOrNull(t.start_on)) : null;
        const st = milestoneDay ?? dayOrNull(t.start_on) ?? dayOrNull(t.due_on)!;
        const en = milestoneDay ?? dayOrNull(t.due_on) ?? dayOrNull(t.start_on)!;
        rowY.set(
          t.id,
          group.top + (group.laneById.get(t.id) ?? 0) * TIMELINE_ROW_PITCH + TIMELINE_ROW_PITCH / 2,
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

  const dependencyShapes = useMemo<TimelineDependencyShape[]>(
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

  return { groups, rowY, pos, edges, dependencyShapes, milestoneLines };
}
