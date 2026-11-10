"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { TaskTimelineRow } from "./timeline-task-payload";
import { todayISO } from "./dates";
import { dayOrNull } from "./task-dates";
import { DAY_MS } from "./calendar";
import { buildTimelineAxis, timelineDateWindow, ZOOM_PRESETS } from "./timeline-axis";

export { ZOOM_PRESETS } from "./timeline-axis";

/** Timeline horizontal range, zoom and axis buckets. */
export function useTimelineViewport({
  dated,
  startOverride,
  initialZoom,
  scrollRef,
  contentRef,
}: {
  dated: TaskTimelineRow[];
  startOverride: number | null;
  initialZoom: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const storedZoom =
    Number.isInteger(initialZoom) && initialZoom >= 0 && initialZoom < ZOOM_PRESETS.length
      ? initialZoom
      : 2;
  const [zoom, setZoom] = useState(storedZoom);
  const zoomPreset = ZOOM_PRESETS[zoom];
  const dayWidth = zoomPreset.dayWidth;
  const pendingAnchor = useRef<{ day: number } | null>(null);
  const lastScrolledRange = useRef<number | null | undefined>(undefined);
  const [zoomAnchor, setZoomAnchor] = useState<{ from: number | null; day: number } | null>(null);
  const todayDay = dayOrNull(todayISO())!;

  const dateBounds = useMemo(() => {
    let min = Number.MAX_SAFE_INTEGER;
    let max = Number.MIN_SAFE_INTEGER;
    for (const t of dated) {
      const s = dayOrNull(t.start_on) ?? dayOrNull(t.due_on)!;
      const e = dayOrNull(t.due_on) ?? dayOrNull(t.start_on)!;
      min = Math.min(min, s);
      max = Math.max(max, e);
    }
    if (dated.length === 0) {
      min = todayDay - 7;
      max = todayDay + 35;
    } else {
      min -= 3;
      max += 10;
      // Align the canvas to whole weeks so the first/last axis labels are not
      // squeezed into a partial cell.
      min -= new Date(min * DAY_MS).getUTCDay();
      max += 6 - new Date(max * DAY_MS).getUTCDay();
    }
    return { min, max };
  }, [dated, todayDay]);
  const { min, max, navigationDays } = timelineDateWindow(
    dateBounds.min,
    dateBounds.max,
    startOverride,
    zoomAnchor?.from === startOverride ? zoomAnchor.day : null,
    todayDay,
    zoomPreset,
  );
  const span = max - min + 1;
  const dayPct = 100 / span;

  const pct = useCallback(
    (d: number) => `${((d - min) / span) * 100}%`,
    [min, span],
  );

  const changeZoom = (next: number) => {
    const clamped = Math.max(0, Math.min(ZOOM_PRESETS.length - 1, next));
    if (clamped === zoom) return;
    const scroller = scrollRef.current;
    if (scroller) {
      const width = contentRef.current?.offsetWidth ?? Math.max(700, span * dayWidth);
      const centerX = scroller.scrollLeft + scroller.clientWidth / 2;
      const day = min + (centerX / Math.max(1, width)) * span;
      pendingAnchor.current = { day };
      setZoomAnchor({ from: startOverride, day });
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
  }, [zoom, min, span, dayWidth, scrollRef, contentRef]);

  const showToday = todayDay >= min && todayDay <= max;

  useEffect(() => {
    if (lastScrolledRange.current === startOverride) return;
    const scroller = scrollRef.current;
    const canvas = contentRef.current;
    if (!scroller || !canvas || canvas.offsetWidth === 0) return;
    const x = ((todayDay - min) / span) * canvas.offsetWidth;
    scroller.scrollLeft = startOverride === null ? Math.max(0, x - scroller.clientWidth / 2) : 0;
    lastScrolledRange.current = startOverride;
  }, [min, span, todayDay, startOverride, scrollRef, contentRef]);

  const { axisTop, axisBottom, weekendDays, gridLines } = useMemo(
    () => buildTimelineAxis(min, max, zoomPreset.key),
    [min, max, zoomPreset.key],
  );

  return {
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
    anchorDay: (zoomAnchor?.from === startOverride ? zoomAnchor.day : null) ?? startOverride ?? todayDay,
    todayDay,
    showToday,
    weekendDays,
    axisTop,
    axisBottom,
    gridLines,
  };
}
