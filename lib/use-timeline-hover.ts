"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TimelineCanvasHover = {
  sectionId: number;
  top: number;
  height: number;
  day: number;
} | null;

/** Canvas and bar hover state with delayed tooltip dismissal. */
export function useTimelineHover() {
  const [hover, setHover] = useState<TimelineCanvasHover>(null);
  const [barHoverId, setBarHoverId] = useState<number | null>(null);
  const [barOverflowId, setBarOverflowId] = useState<number | null>(null);
  const barHoverTimer = useRef<number | null>(null);
  const barHoverFrame = useRef<number | null>(null);
  const barHoverIdRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (barHoverTimer.current) window.clearTimeout(barHoverTimer.current);
      if (barHoverFrame.current !== null) window.cancelAnimationFrame(barHoverFrame.current);
    },
    [],
  );

  const showBarHover = useCallback((id: number) => {
    if (barHoverTimer.current) {
      window.clearTimeout(barHoverTimer.current);
      barHoverTimer.current = null;
    }
    barHoverIdRef.current = id;
    setBarHoverId(id);
    // Asana only shows the bar tooltip when the task name is clipped by the
    // bar. Measure after the hover inset is painted.
    if (barHoverFrame.current !== null) window.cancelAnimationFrame(barHoverFrame.current);
    barHoverFrame.current = window.requestAnimationFrame(() => {
      barHoverFrame.current = null;
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
  }, []);

  const scheduleBarHoverClear = useCallback(() => {
    if (barHoverTimer.current) window.clearTimeout(barHoverTimer.current);
    barHoverTimer.current = window.setTimeout(() => {
      barHoverIdRef.current = null;
      setBarHoverId(null);
      setBarOverflowId(null);
      barHoverTimer.current = null;
    }, 160);
  }, []);

  /** Dismiss the bar tooltip immediately (used when a drag starts). */
  const clearBarHover = useCallback(() => {
    if (barHoverTimer.current) {
      window.clearTimeout(barHoverTimer.current);
      barHoverTimer.current = null;
    }
    barHoverIdRef.current = null;
    setBarHoverId(null);
    setBarOverflowId(null);
  }, []);

  return {
    hover,
    setHover,
    barHoverId,
    barOverflowId,
    showBarHover,
    scheduleBarHoverClear,
    clearBarHover,
  };
}
