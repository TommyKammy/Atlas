"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { TaskTimelineRow } from "./timeline-task-payload";
import type { TimelineGroup } from "./use-timeline-layout";
import { dayDeltaFromPixels } from "./timeline-dnd";
import { TIMELINE_EDGE_HIT, TIMELINE_ROW_PITCH } from "./timeline-metrics";

export type TimelineDragMode = "move" | "start" | "end";

export type TimelineDragState = {
  id: number;
  pointerId: number;
  mode: TimelineDragMode;
  axis: "x" | "row" | null;
  dx: number;
  dy: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  rowDrop: { sectionId: number; row: number; top: number } | null;
};

function horizontalDragOffset(drag: TimelineDragState, pointerX: number, scroller: HTMLDivElement | null) {
  const scrollLeft = scroller?.scrollLeft ?? drag.startScrollLeft;
  return pointerX - drag.startX + scrollLeft - drag.startScrollLeft;
}

/** Pointer drag, edge resize, long-press row drag and drop commit. */
export function useTimelineDrag({
  contentRef,
  scrollRef,
  groups,
  tasks,
  span,
  canEdit,
  onDragStart,
  onCommit,
  onRowDrop,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  groups: TimelineGroup[];
  tasks: TaskTimelineRow[];
  span: number;
  canEdit: boolean;
  onDragStart: () => void;
  onCommit: (task: TaskTimelineRow, delta: number, mode: TimelineDragMode) => Promise<void>;
  onRowDrop: (task: TaskTimelineRow, row: number) => Promise<void>;
}) {
  const [drag, setDrag] = useState<TimelineDragState | null>(null);
  const activeDrag = useRef<TimelineDragState | null>(null);
  const latestPointerX = useRef(0);
  const longPressTimer = useRef<number | null>(null);
  const moved = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current === null) return;
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  const publishDrag = useCallback((next: TimelineDragState | null) => {
    activeDrag.current = next;
    setDrag(next);
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const current = activeDrag.current;
      if (current?.axis !== "x") return;
      const dx = horizontalDragOffset(current, latestPointerX.current, scroller);
      if (dx !== current.dx) publishDrag({ ...current, dx });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [publishDrag, scrollRef]);

  const beginDrag = useCallback((
    e: ReactPointerEvent,
    t: TaskTimelineRow,
    mode: TimelineDragMode,
  ) => {
    if (e.button !== 0 || !e.isPrimary || activeDrag.current) return;
    moved.current = false;
    if (!canEdit) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragStart();
    clearLongPress();
    latestPointerX.current = e.clientX;
    if (e.pointerType === "touch" && mode === "move") {
      const pointerId = e.pointerId;
      longPressTimer.current = window.setTimeout(() => {
        const current = activeDrag.current;
        longPressTimer.current = null;
        if (current?.pointerId === pointerId && current.axis === null) {
          publishDrag({ ...current, axis: "row" });
        }
      }, 300);
    }
    publishDrag({
      id: t.id,
      pointerId: e.pointerId,
      mode,
      axis: null,
      dx: 0,
      dy: 0,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      rowDrop: null,
    });
  }, [canEdit, clearLongPress, onDragStart, publishDrag, scrollRef]);

  const beginBarDrag = useCallback((e: ReactPointerEvent, t: TaskTimelineRow) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromLeft = e.clientX - rect.left;
    const fromRight = rect.right - e.clientX;
    const edgeHit = Math.min(TIMELINE_EDGE_HIT, Math.max(4, rect.width / 4));
    const mode: TimelineDragMode =
      fromLeft <= edgeHit && fromLeft <= fromRight
        ? "start"
        : fromRight <= edgeHit
          ? "end"
          : "move";
    beginDrag(e, t, mode);
  }, [beginDrag]);

  const onBarMove = useCallback((e: ReactPointerEvent) => {
    const drag = activeDrag.current;
    if (drag?.pointerId !== e.pointerId) return;
    latestPointerX.current = e.clientX;
    const pointerDx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(pointerDx) > 2 || Math.abs(dy) > 4) moved.current = true;
    let axis = drag.axis;
    if (axis === null && Math.max(Math.abs(pointerDx), Math.abs(dy)) > 6) {
      axis =
        drag.mode === "move" && canEdit && Math.abs(dy) > Math.abs(pointerDx)
          ? "row"
          : "x";
    }
    const scroller = scrollRef.current;
    if (scroller && axis === "x") {
      const rect = scroller.getBoundingClientRect();
      const edge = 48;
      if (e.clientX < rect.left + edge) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - 14);
      else if (e.clientX > rect.right - edge) scroller.scrollLeft += 14;
    }
    const dx = axis === "x" ? horizontalDragOffset(drag, e.clientX, scroller) : pointerDx;
    if (axis !== null) clearLongPress();
    if (axis === drag.axis && dx === drag.dx && dy === drag.dy && axis !== "row") return;
    if (axis === "row") {
      const group = groups.find((entry) => entry.tasks.some((task) => task.id === drag.id));
      const rect = contentRef.current?.getBoundingClientRect();
      if (!group || !rect) {
        publishDrag({ ...drag, axis, dx: 0, dy, rowDrop: null });
        return;
      }
      const y = e.clientY - rect.top;
      const row = Math.max(
        0,
        Math.min(group.laneCount, Math.floor((y - group.top) / TIMELINE_ROW_PITCH)),
      );
      if (drag.axis === axis && drag.dy === dy && drag.rowDrop?.row === row) return;
      publishDrag({
        ...drag,
        axis,
        dx: 0,
        dy,
        rowDrop: {
          sectionId: group.section.id,
          row,
          top: group.top + row * TIMELINE_ROW_PITCH,
        },
      });
      return;
    }
    publishDrag({ ...drag, axis, dx, dy, rowDrop: null });
  }, [canEdit, clearLongPress, contentRef, groups, publishDrag, scrollRef]);

  const onBarCancel = useCallback((e: ReactPointerEvent) => {
    if (activeDrag.current?.pointerId !== e.pointerId) return;
    clearLongPress();
    moved.current = true;
    publishDrag(null);
  }, [clearLongPress, publishDrag]);

  const onBarUp = useCallback(async (e: ReactPointerEvent) => {
    const d = activeDrag.current;
    if (d?.pointerId !== e.pointerId) return;
    clearLongPress();
    publishDrag(null);
    if (d.axis === "row") {
      if (!d.rowDrop) return;
      const target = tasks.find((x) => x.id === d.id);
      if (target) await onRowDrop(target, d.rowDrop.row);
      return;
    }
    if (d.axis !== "x") return;
    const el = contentRef.current;
    if (!el) return;
    const t = tasks.find((x) => x.id === d.id);
    if (!t) return;
    const dx = horizontalDragOffset(d, e.clientX, scrollRef.current);
    const delta = dayDeltaFromPixels(dx, el.getBoundingClientRect().width, span);
    await onCommit(t, delta, d.mode);
  }, [clearLongPress, contentRef, onCommit, onRowDrop, publishDrag, scrollRef, span, tasks]);

  return { drag, moved, beginDrag, beginBarDrag, onBarMove, onBarUp, onBarCancel };
}
