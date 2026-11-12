"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { TaskTimelineRow } from "./timeline-task-payload";
import type { TimelineGroup } from "./use-timeline-layout";
import { dayDeltaFromPixels } from "./timeline-dnd";
import { TIMELINE_EDGE_HIT, TIMELINE_ROW_PITCH } from "./timeline-metrics";
import { resolveTimelineTaskDrop, timelineInsertionPlacements, type TimelineRowPlacement, type TimelineRowDrop } from "./timeline-row-drop";

export type TimelineDragMode = "move" | "start" | "end";

export type TimelineDragState = {
  id: number;
  pointerId: number;
  mode: TimelineDragMode;
  // Current drop intent, never a constraint on the floating bar's movement.
  axis: "x" | "row" | null;
  dx: number;
  dy: number;
  dateDelta: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startCanvasTop: number;
  rowDrop: TimelineRowDrop | null;
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
  span,
  canEdit,
  onDragStart,
  onCommit,
  onRowDrop,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  groups: TimelineGroup[];
  span: number;
  canEdit: boolean;
  onDragStart: () => void;
  onCommit: (task: TaskTimelineRow, delta: number, mode: TimelineDragMode) => Promise<void>;
  onRowDrop: (task: TaskTimelineRow, sectionId: number | null, row: number, placements?: TimelineRowPlacement[], dateDelta?: number) => Promise<void>;
}) {
  const [drag, setDrag] = useState<TimelineDragState | null>(null);
  const activeDrag = useRef<TimelineDragState | null>(null);
  const dragTask = useRef<TaskTimelineRow | null>(null);
  const captureTarget = useRef<Element | null>(null);
  const latestPointer = useRef({ x: 0, y: 0 });
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

  const cancelDrag = useCallback(() => {
    clearLongPress();
    moved.current = true;
    dragTask.current = null;
    captureTarget.current = null;
    publishDrag(null);
  }, [clearLongPress, publishDrag]);

  useEffect(() => {
    const cancel = (event: PointerEvent) => {
      if (activeDrag.current?.pointerId === event.pointerId) cancelDrag();
    };
    const cancelDetached = (event: PointerEvent) => {
      if (!captureTarget.current?.isConnected) cancel(event);
    };
    // A live section change can remove the capture owner before React gets a
    // pointerup/lostcapture event on that bar. These listeners only cancel.
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("lostpointercapture", cancel, true);
    window.addEventListener("pointerup", cancelDetached, true);
    window.addEventListener("pointermove", cancelDetached, true);
    return () => {
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("lostpointercapture", cancel, true);
      window.removeEventListener("pointerup", cancelDetached, true);
      window.removeEventListener("pointermove", cancelDetached, true);
    };
  }, [cancelDrag]);

  const dragPosition = useCallback((current: TimelineDragState, pointerX: number, pointerY: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    const dx = horizontalDragOffset(current, pointerX, scrollRef.current);
    const pointerDy = pointerY - current.startY + current.startCanvasTop - (rect?.top ?? current.startCanvasTop);
    const active = current.axis !== null || Math.max(Math.abs(dx), Math.abs(pointerDy)) > 6;
    const axis: TimelineDragState["axis"] = !active ? null : current.mode === "move" && Math.abs(pointerDy) > 6 ? "row" : "x";
    // The section-name sidebar has no date coordinate. Keep its existing
    // section-only drop behavior, but honor X on every canvas row drop.
    const overSidebar = current.mode === "move" && scrollRef.current &&
      pointerX < scrollRef.current.getBoundingClientRect().left;
    const dateDelta = overSidebar ? 0 : dayDeltaFromPixels(dx, rect?.width ?? 0, span);
    const rowDrop = axis === "row" && rect
      ? resolveTimelineTaskDrop(groups, pointerY - rect.top, rect.height, current.id, current.rowDrop, dateDelta) : null;
    const source = groups.find((group) => group.laneById.has(current.id));
    // Opening an insertion gap above the source shifts its DOM wrapper. Offset
    // that shift so the grabbed point stays under the pointer, even on scroll.
    const sourceShift = rowDrop?.insert && source &&
      source.top > groups.find((group) => group.sectionId === rowDrop.sectionId)!.top ? TIMELINE_ROW_PITCH : 0;
    return {
      axis, dx, dateDelta,
      dy: current.mode === "move" ? pointerDy - sourceShift : 0,
      rowDrop: sameRowDrop(rowDrop, current.rowDrop) ? current.rowDrop : rowDrop,
    };
  }, [contentRef, groups, scrollRef, span]);

  useEffect(() => {
    const onScroll = () => {
      const current = activeDrag.current;
      if (current?.axis) {
        const next = dragPosition(current, latestPointer.current.x, latestPointer.current.y);
        if (next.dx !== current.dx || next.dy !== current.dy || next.axis !== current.axis || !sameRowDrop(next.rowDrop, current.rowDrop)) {
          publishDrag({ ...current, ...next });
        }
      }
    };
    // Capture also sees the main page's vertical scrolling, not just canvas X.
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [publishDrag, dragPosition]);

  const dragging = Boolean(drag?.axis);
  useEffect(() => {
    if (!dragging) return;
    const scroller = verticalScrollParent(contentRef.current, scrollRef.current);
    let frame = 0;
    const tick = () => {
      const current = activeDrag.current;
      if (!current?.axis) return;
      if (!captureTarget.current?.isConnected) {
        cancelDrag();
        return;
      }
      const horizontal = scrollRef.current;
      if (horizontal) {
        const rect = horizontal.getBoundingClientRect();
        const x = latestPointer.current.x;
        // Section-name drops outside the canvas must not scroll its dates.
        if (x >= rect.left && x < rect.left + 48) horizontal.scrollLeft -= 14;
        else if (x > rect.right - 48 && x <= rect.right) horizontal.scrollLeft += 14;
      }
      const rect = scroller === document.scrollingElement
        ? { top: 0, bottom: window.innerHeight }
        : scroller?.getBoundingClientRect();
      const y = latestPointer.current.y;
      if (current.mode === "move" && scroller && rect) {
        if (y < rect.top + 48) scroller.scrollTop -= 14;
        else if (y > rect.bottom - 48) scroller.scrollTop += 14;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [cancelDrag, contentRef, dragging, scrollRef]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !activeDrag.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [cancelDrag]);

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
    captureTarget.current = e.currentTarget;
    onDragStart();
    clearLongPress();
    latestPointer.current = { x: e.clientX, y: e.clientY };
    // Keep the version visible at pointerdown, even if live data refreshes.
    dragTask.current = t;
    if (e.pointerType === "touch" && mode === "move") {
      const pointerId = e.pointerId;
      longPressTimer.current = window.setTimeout(() => {
        const current = activeDrag.current;
        longPressTimer.current = null;
        if (!captureTarget.current?.isConnected) {
          cancelDrag();
          return;
        }
        if (current?.pointerId === pointerId && current.axis === null) {
          publishDrag({ ...current, axis: "x" });
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
      dateDelta: 0,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      startCanvasTop: contentRef.current?.getBoundingClientRect().top ?? 0,
      rowDrop: null,
    });
  }, [canEdit, cancelDrag, clearLongPress, contentRef, onDragStart, publishDrag, scrollRef]);

  const beginBarDrag = useCallback((e: ReactPointerEvent, t: TaskTimelineRow) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 12 || t.is_milestone || e.clientX < rect.left || e.clientX > rect.right) {
      beginDrag(e, t, "move");
      return;
    }
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
    latestPointer.current = { x: e.clientX, y: e.clientY };
    const pointerDx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(pointerDx) > 2 || Math.abs(dy) > 4) moved.current = true;
    const next = dragPosition(drag, e.clientX, e.clientY);
    if (next.axis !== null) clearLongPress();
    if (next.axis === drag.axis && next.dx === drag.dx && next.dy === drag.dy && sameRowDrop(next.rowDrop, drag.rowDrop)) return;
    publishDrag({ ...drag, ...next });
  }, [clearLongPress, publishDrag, dragPosition]);

  const onBarCancel = useCallback((e: ReactPointerEvent) => {
    if (activeDrag.current?.pointerId !== e.pointerId) return;
    cancelDrag();
  }, [cancelDrag]);

  const onBarUp = useCallback(async (e: ReactPointerEvent) => {
    const d = activeDrag.current;
    if (d?.pointerId !== e.pointerId) return;
    clearLongPress();
    const t = dragTask.current;
    dragTask.current = null;
    captureTarget.current = null;
    publishDrag(null);
    if (!t) return;
    if (!moved.current) return;
    const final = dragPosition(d, e.clientX, e.clientY);
    if (final.axis === "row") {
      const drop = final.rowDrop;
      if (!drop) return;
      const source = groups.find((group) => group.laneById.has(t.id));
      if (drop.insert || source?.sectionId !== drop.sectionId || source.laneById.get(t.id) !== drop.row) {
        const group = groups.find((g) => g.sectionId === drop.sectionId)!;
        const placements = timelineInsertionPlacements(group, t.id, drop);
        await onRowDrop(t, drop.sectionId, drop.row, placements, final.dateDelta);
        return;
      }
    }
    if (final.axis === null) return;
    await onCommit(t, final.dateDelta, d.mode);
  }, [clearLongPress, onCommit, onRowDrop, publishDrag, dragPosition, groups]);

  return { drag, moved, beginDrag, beginBarDrag, onBarMove, onBarUp, onBarCancel };
}

function sameRowDrop(a: TimelineRowDrop | null, b: TimelineRowDrop | null) {
  return a === b || Boolean(a && b && a.sectionId === b.sectionId && a.row === b.row && a.top === b.top && a.insert === b.insert);
}

function verticalScrollParent(element: HTMLElement | null, horizontalScroller: HTMLElement | null): HTMLElement | null {
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    // A translated ghost can create artificial Y overflow in the X scroller.
    if (parent === horizontalScroller) continue;
    if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}
