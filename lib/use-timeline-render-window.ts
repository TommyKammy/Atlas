"use client";

import { useEffect, useState, type RefObject } from "react";

const INITIAL_HORIZONTAL_BUFFER = 220;
const LABEL_BUFFER = 180; // External labels are up to 172px wide with an 8px gap.
const SCROLL_REUSE_DISTANCE = 240;
const VERTICAL_BUFFER = 160;

type Viewport = {
  left: number;
  width: number;
  top: number;
  bottom: number;
  min: number;
  span: number;
  dayWidth: number;
};

type RenderWindow = {
  left: number;
  right: number;
  initialRight: number | null;
  top: number;
  bottom: number;
  canvasWidth: number;
};

function coversHorizontalScroll(left: number, scrollLeft: number) {
  return Math.abs(scrollLeft - left) <= SCROLL_REUSE_DISTANCE;
}

/** A render window in canvas pixels. Lane assignment and date ranges remain complete. */
export function useTimelineRenderWindow({
  enabled,
  scrollRef,
  contentRef,
  min,
  span,
  dayWidth,
  anchorDay,
}: {
  enabled: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  min: number;
  span: number;
  dayWidth: number;
  anchorDay: number | null;
}): RenderWindow | null {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const scroller = scrollRef.current;
    const canvas = contentRef.current;
    if (!scroller || !canvas) return;
    const main = scroller.closest("main");
    const verticalScroller = main ?? window;
    let frame = 0;
    let geometryDirty = true;
    let measured: Viewport | null = null;
    const measure = () => {
      frame = 0;
      const scrollLeft = scroller.scrollLeft;
      // Keep enough bars mounted on both sides of the last measured position
      // that reversals can reuse the same window.
      const left = measured && coversHorizontalScroll(measured.left, scrollLeft)
        ? measured.left
        : Math.max(0, scrollLeft);
      let width = measured?.width ?? 0;
      let top = measured?.top ?? 0;
      let bottom = measured?.bottom ?? 0;
      if (geometryDirty) {
        geometryDirty = false;
        const canvasTop = canvas.getBoundingClientRect().top;
        const mainRect = main?.getBoundingClientRect();
        const visibleTop = Math.max(0, (mainRect?.top ?? 0) - canvasTop);
        const visibleBottom = Math.max(visibleTop, Math.min(window.innerHeight, mainRect?.bottom ?? window.innerHeight) - canvasTop);
        width = scroller.clientWidth;
        top = Math.floor(visibleTop / VERTICAL_BUFFER) * VERTICAL_BUFFER;
        bottom = Math.ceil(visibleBottom / VERTICAL_BUFFER) * VERTICAL_BUFFER;
      }
      if (measured && measured.left === left && measured.width === width &&
          measured.top === top && measured.bottom === bottom) return;
      measured = { left, width, top, bottom, min, span, dayWidth };
      setViewport(measured);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    const scheduleGeometry = () => {
      geometryDirty = true;
      schedule();
    };
    const onHorizontalScroll = () => {
      if (!measured || !coversHorizontalScroll(measured.left, scroller.scrollLeft)) schedule();
    };
    const observer = new ResizeObserver(scheduleGeometry);
    observer.observe(scroller);
    observer.observe(canvas);
    if (main) observer.observe(main);
    scroller.addEventListener("scroll", onHorizontalScroll, { passive: true });
    verticalScroller.addEventListener("scroll", scheduleGeometry, { passive: true });
    window.addEventListener("resize", scheduleGeometry);
    schedule();
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", onHorizontalScroll);
      verticalScroller.removeEventListener("scroll", scheduleGeometry);
      window.removeEventListener("resize", scheduleGeometry);
    };
  }, [enabled, scrollRef, contentRef, min, span, dayWidth]);

  if (!enabled) return null;
  const width = viewport?.width || 1000;
  const canvasWidth = Math.max(700, span * dayWidth, viewport?.width ?? 0);
  const sameScale = viewport?.min === min && viewport.span === span && viewport.dayWidth === dayWidth;
  const predictedLeft = anchorDay === null ? 0 : ((anchorDay - min) / span) * canvasWidth - width / 2;
  const left = sameScale ? viewport.left : Math.max(0, Math.min(canvasWidth - width, predictedLeft));
  // Keep the initial HTML window small. Once measured, reserve enough room
  // to reuse it on horizontal scroll without clipping labels at the edges.
  const measuredBuffer = LABEL_BUFFER + SCROLL_REUSE_DISTANCE;
  return {
    left: left - (sameScale ? measuredBuffer : INITIAL_HORIZONTAL_BUFFER),
    right: left + width + (sameScale ? measuredBuffer : INITIAL_HORIZONTAL_BUFFER * 2),
    // Before hydration the browser is also showing scrollLeft=0.
    initialRight: viewport === null ? width + INITIAL_HORIZONTAL_BUFFER : null,
    top: (viewport?.top ?? 0) - VERTICAL_BUFFER,
    bottom: (viewport?.bottom ?? 1000) + VERTICAL_BUFFER,
    canvasWidth,
  };
}

export function isTimelineBarInWindow(
  window: RenderWindow,
  position: { x1: string; x2: string },
  top: number,
  height: number,
): boolean {
  if (top + height < window.top || top > window.bottom) return false;
  const left = parseFloat(position.x1) * window.canvasWidth / 100;
  const right = parseFloat(position.x2) * window.canvasWidth / 100;
  return (right >= window.left && left <= window.right) ||
    (window.initialRight !== null && left <= window.initialRight);
}
