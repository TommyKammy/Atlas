"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { TaskRow } from "./data";
import type { TimelineGroup } from "./use-timeline-layout";
import { dayDeltaFromPixels } from "./timeline-dnd";
import { TIMELINE_EDGE_HIT, TIMELINE_ROW_PITCH } from "./timeline-metrics";

export type TimelineDragMode = "move" | "start" | "end";

export type TimelineDragState = {
  id: number;
  mode: TimelineDragMode;
  axis: "x" | "row" | null;
  dx: number;
  dy: number;
  startX: number;
  startY: number;
  rowDrop: { sectionId: number; row: number; top: number } | null;
};

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
  tasks: TaskRow[];
  span: number;
  canEdit: boolean;
  onDragStart: () => void;
  onCommit: (task: TaskRow, delta: number, mode: TimelineDragMode) => Promise<void>;
  onRowDrop: (task: TaskRow, row: number) => Promise<void>;
}) {
  const [drag, setDrag] = useState<TimelineDragState | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const moved = useRef(false);

  const beginDrag = (
    e: ReactPointerEvent,
    t: TaskRow,
    mode: TimelineDragMode,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    moved.current = false;
    onDragStart();
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

  const beginBarDrag = (e: ReactPointerEvent, t: TaskRow) => {
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
  };

  const onBarMove = (e: ReactPointerEvent) => {
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
        Math.min(group.laneCount, Math.floor((y - group.top) / TIMELINE_ROW_PITCH)),
      );
      setDrag({
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
      if (target) await onRowDrop(target, d.rowDrop.row);
      return;
    }
    if (d.axis !== "x") return;
    const el = contentRef.current;
    if (!el) return;
    const t = tasks.find((x) => x.id === d.id);
    if (!t) return;
    const delta = dayDeltaFromPixels(d.dx, el.getBoundingClientRect().width, span);
    await onCommit(t, delta, d.mode);
  };

  const dragDelta = (id: number) => (drag && drag.id === id ? drag.dx : 0);

  return { drag, moved, beginDrag, beginBarDrag, onBarMove, onBarUp, dragDelta };
}
