"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { TaskRow } from "./data";
import { todayISO } from "./dates";
import { dayOrNull } from "./task-dates";

const DAY_MS = 86_400_000;

export const ZOOM_PRESETS = [
  { key: "hour", label: "時間", dayWidth: 5064 },
  { key: "day", label: "日", dayWidth: 40 },
  { key: "week", label: "週", dayWidth: 24 },
  { key: "month", label: "月", dayWidth: 12 },
  { key: "quarter", label: "四半期", dayWidth: 4 },
  { key: "half", label: "半年", dayWidth: 2 },
  { key: "year", label: "年", dayWidth: 1 },
] as const;

export type TimelineZoomPreset = (typeof ZOOM_PRESETS)[number];

type AxisInterval = { key: string; start: number; end: number; label: string; daysWide: number };

function isoWeek(day: number): number {
  const d = new Date(day * DAY_MS);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
}

function weekLabel(start: number): string {
  const a = new Date(start * DAY_MS);
  const b = new Date((start + 6) * DAY_MS);
  const range =
    a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()} - ${b.getUTCDate()}`
      : `${a.getUTCMonth() + 1}月${a.getUTCDate()}日 - ${b.getUTCDate()}`;
  // Weeks start on Sunday in the Asana timeline; ISO week numbers are Monday-based.
  return `W${isoWeek(start + 1)} ${range}`;
}

/** Timeline horizontal range, zoom and axis buckets. */
export function useTimelineViewport({
  dated,
  startOverride,
  initialZoom,
  scrollRef,
  contentRef,
}: {
  dated: TaskRow[];
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
  const zoomPreset: TimelineZoomPreset = ZOOM_PRESETS[zoom];
  const dayWidth = zoomPreset.dayWidth;
  const pendingAnchor = useRef<{ day: number } | null>(null);
  const initialScrollDone = useRef(false);

  const { min, max, span, dayPct } = useMemo(() => {
    let min = Number.MAX_SAFE_INTEGER;
    let max = Number.MIN_SAFE_INTEGER;
    for (const t of dated) {
      const s = dayOrNull(t.start_on) ?? dayOrNull(t.due_on)!;
      const e = dayOrNull(t.due_on) ?? dayOrNull(t.start_on)!;
      min = Math.min(min, s);
      max = Math.max(max, e);
    }
    if (dated.length === 0) {
      const today = dayOrNull(todayISO())!;
      min = today - 7;
      max = today + 35;
    } else {
      min -= 3;
      max += 10;
      // Align the canvas to whole weeks so the first/last axis labels are not
      // squeezed into a partial cell.
      min -= new Date(min * DAY_MS).getUTCDay();
      max += 6 - new Date(max * DAY_MS).getUTCDay();
    }
    if (startOverride !== null) {
      min = startOverride;
      if (max < min) max = min + 30;
    }
    let span = Math.max(1, max - min + 1);
    // Keep enough content around the tasks so coarse zoom levels do not stretch
    // a short project across the viewport (Asana extends its timeline range).
    const desiredSpan = Math.max(1, Math.ceil(1680 / dayWidth));
    if (span < desiredSpan) {
      const extra = desiredSpan - span;
      const before = Math.floor(extra / 2);
      min -= before;
      max += extra - before;
      span = Math.max(1, max - min + 1);
    }
    return { min, max, span, dayPct: 100 / span };
  }, [dated, startOverride, dayWidth]);

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
      pendingAnchor.current = { day: min + (centerX / Math.max(1, width)) * span };
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

  const todayDay = dayOrNull(todayISO())!;
  const showToday = todayDay >= min && todayDay <= max;

  useEffect(() => {
    if (initialScrollDone.current) return;
    const scroller = scrollRef.current;
    const canvas = contentRef.current;
    if (!scroller || !canvas || canvas.offsetWidth === 0) return;
    const x = ((todayDay - min) / span) * canvas.offsetWidth;
    scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
    initialScrollDone.current = true;
  }, [min, span, todayDay, scrollRef, contentRef]);

  const firstWeek = min - new Date(min * DAY_MS).getUTCDay();
  const lastWeek = max + (6 - new Date(max * DAY_MS).getUTCDay());
  const { weeks, weekLines } = useMemo(() => {
    const weeks: { start: number; left: number; right: number; label: string }[] = [];
    for (let d = firstWeek; d <= lastWeek; d += 7) {
      if (d + 6 < min || d > max) continue;
      weeks.push({
        start: d,
        left: Math.max(d, min),
        right: Math.min(d + 6, max),
        label: weekLabel(d),
      });
    }
    const weekLines: number[] = [];
    for (let d = firstWeek; d <= lastWeek; d += 7) {
      if (d >= min && d <= max) weekLines.push(d);
    }
    return { weeks, weekLines };
  }, [firstWeek, lastWeek, min, max]);

  const months: { start: number; end: number; label: string }[] = [];
  for (let d = min; d <= max; ) {
    const dt = new Date(d * DAY_MS);
    const yNum = dt.getUTCFullYear();
    const mNum = dt.getUTCMonth();
    const next = Date.UTC(yNum, mNum + 1, 1) / DAY_MS;
    months.push({ start: d, end: Math.min(next - 1, max), label: `${mNum + 1}月` });
    d = next;
  }

  const days: number[] = [];
  const weekendDays: number[] = [];
  for (let d = min; d <= max; d++) {
    days.push(d);
    const wd = new Date(d * DAY_MS).getUTCDay();
    if (wd === 0 || wd === 6) weekendDays.push(d);
  }

  const buildIntervals = (keyOf: (d: number) => { key: string; label: string }): AxisInterval[] => {
    const out: Array<Omit<AxisInterval, "daysWide">> = [];
    let current: Omit<AxisInterval, "daysWide"> | null = null;
    for (let d = min; d <= max; d++) {
      const { key, label } = keyOf(d);
      if (!current || current.key !== key) {
        if (current) current.end = d - 1;
        current = { key, start: d, end: d, label };
        out.push(current);
      } else {
        current.end = d;
      }
    }
    return out.map((interval) => ({ ...interval, daysWide: interval.end - interval.start + 1 }));
  };
  const monthIntervals = buildIntervals((d) => {
    const dt = new Date(d * DAY_MS);
    return { key: `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`, label: `${dt.getUTCMonth() + 1}月` };
  });
  const yearIntervals = buildIntervals((d) => {
    const y = new Date(d * DAY_MS).getUTCFullYear();
    return { key: `${y}`, label: `${y}年` };
  });
  const quarterIntervals = buildIntervals((d) => {
    const dt = new Date(d * DAY_MS);
    const q = Math.floor(dt.getUTCMonth() / 3) + 1;
    return { key: `${dt.getUTCFullYear()}-Q${q}`, label: `Q${q}` };
  });
  const dayIntervals = buildIntervals((d) => {
    const dt = new Date(d * DAY_MS);
    return { key: `${d}`, label: `${dt.getUTCDate()}` };
  });
  const hourDayIntervals = buildIntervals((d) => {
    const dt = new Date(d * DAY_MS);
    return { key: `${d}`, label: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}` };
  });
  const hourIntervals: AxisInterval[] = [];
  for (let d = min; d <= max; d++) {
    for (let h = 0; h < 24; h++) {
      hourIntervals.push({
        key: `${d}-${h}`,
        start: d + h / 24,
        end: d + (h + 1) / 24,
        label: `${h}:00`,
        daysWide: 1 / 24,
      });
    }
  }
  const axisTop =
    zoomPreset.key === "hour"
      ? hourDayIntervals
      : zoomPreset.key === "day" || zoomPreset.key === "week"
        ? monthIntervals
        : yearIntervals;
  const axisBottom =
    zoomPreset.key === "hour"
      ? hourIntervals
      : zoomPreset.key === "day"
        ? dayIntervals
        : zoomPreset.key === "week"
          ? weeks.map((w) => ({
              key: `w-${w.start}`,
              start: w.left,
              end: w.right,
              label: w.label,
              daysWide: w.right - w.left + 1,
            }))
          : zoomPreset.key === "month" || zoomPreset.key === "quarter"
            ? monthIntervals
            : quarterIntervals;
  const gridLines =
    zoomPreset.key === "hour"
      ? hourIntervals.filter((h) => !h.label.startsWith("0:00")).map((h) => h.start)
      : zoomPreset.key === "day" || zoomPreset.key === "week"
        ? days
        : zoomPreset.key === "month"
          ? weekLines
          : zoomPreset.key === "quarter"
            ? monthIntervals.map((m) => m.start)
            : quarterIntervals.map((q) => q.start);

  return {
    zoom,
    setZoom,
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
    weeks,
    weekLines,
    months,
    days,
    weekendDays,
    axisTop,
    axisBottom,
    gridLines,
  };
}
