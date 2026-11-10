"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { TaskTimelineRow } from "./timeline-task-payload";
import { toast } from "./ui-feedback";

export type TimelineDependencyLink = {
  fromId: number;
  edge: "start" | "end";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** Dependency-link drag state and handlers for the timeline. */
export function useTimelineDependencies({
  contentRef,
  scrollRef,
  refresh,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  refresh: () => void;
}) {
  const [depLink, setDepLink] = useState<TimelineDependencyLink | null>(null);
  const [depTargetId, setDepTargetId] = useState<number | null>(null);
  const [hoveredDep, setHoveredDep] = useState<string | null>(null);
  const depHoverTimer = useRef<number | null>(null);
  const activeLink = useRef<{ pointerId: number; fromId: number; edge: "start" | "end" } | null>(null);

  useEffect(() => () => {
    if (depHoverTimer.current !== null) window.clearTimeout(depHoverTimer.current);
  }, []);

  const showDepHover = useCallback((key: string) => {
    if (depHoverTimer.current) {
      window.clearTimeout(depHoverTimer.current);
      depHoverTimer.current = null;
    }
    setHoveredDep(key);
  }, []);

  const scheduleDepHoverClear = useCallback(() => {
    if (depHoverTimer.current) window.clearTimeout(depHoverTimer.current);
    depHoverTimer.current = window.setTimeout(() => {
      setHoveredDep(null);
      depHoverTimer.current = null;
    }, 180);
  }, []);

  const beginDependency = useCallback((
    e: ReactPointerEvent,
    t: TaskTimelineRow,
    edge: "start" | "end",
  ) => {
    if (e.button !== 0 || !e.isPrimary || activeLink.current) return;
    e.preventDefault();
    e.stopPropagation();
    const content = contentRef.current;
    const bar = content?.querySelector<HTMLElement>(`[data-timeline-bar="${t.id}"]`);
    if (!content || !bar) return;
    const contentRect = content.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const x = (edge === "start" ? barRect.left : barRect.right) - contentRect.left;
    const y = barRect.top + barRect.height / 2 - contentRect.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    activeLink.current = { pointerId: e.pointerId, fromId: t.id, edge };
    setDepTargetId(null);
    setDepLink({ fromId: t.id, edge, x1: x, y1: y, x2: x, y2: y });
  }, [contentRef]);

  const moveDependency = useCallback((e: ReactPointerEvent) => {
    const content = contentRef.current;
    const link = activeLink.current;
    if (!content || link?.pointerId !== e.pointerId) return;
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
      target && Number.isInteger(targetId) && targetId !== link.fromId ? targetId : null,
    );
    setDepLink((link) =>
      link ? { ...link, x2: e.clientX - rect.left, y2: e.clientY - rect.top } : link,
    );
  }, [contentRef, scrollRef]);

  const cancelDependency = useCallback((e: ReactPointerEvent) => {
    if (activeLink.current?.pointerId !== e.pointerId) return;
    activeLink.current = null;
    setDepLink(null);
    setDepTargetId(null);
  }, []);

  const endDependency = useCallback(async (e: ReactPointerEvent) => {
    const link = activeLink.current;
    if (link?.pointerId !== e.pointerId) return;
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-timeline-bar]");
    const targetId = Number(target?.getAttribute("data-timeline-bar"));
    const { fromId, edge } = link;
    cancelDependency(e);
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
      if (res.status === 409) toast("循環依存は作成できません");
      return;
    }
    refresh();
  }, [cancelDependency, refresh]);

  const removeDependency = useCallback(async (dep: { task_id: number; depends_on_id: number }) => {
    const res = await fetch(
      `/api/dependencies?task_id=${dep.task_id}&depends_on_id=${dep.depends_on_id}`,
      { method: "DELETE" },
    );
    if (!res.ok) return;
    setHoveredDep(null);
    refresh();
  }, [refresh]);

  return {
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
  };
}
