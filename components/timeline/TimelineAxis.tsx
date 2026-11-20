"use client";

import { memo } from "react";
import type { TimelineAxisInterval } from "@/lib/timeline-axis";

function TimelineAxis({
  axisTop,
  axisBottom,
  weekendDays,
  gridLines,
  showWeekends,
  showToday,
  todayDay,
  pct,
  dayPct,
  dayWidth,
}: {
  axisTop: TimelineAxisInterval[];
  axisBottom: TimelineAxisInterval[];
  weekendDays: number[];
  gridLines: number[];
  showWeekends: boolean;
  showToday: boolean;
  todayDay: number;
  pct: (day: number) => string;
  dayPct: number;
  dayWidth: number;
}) {
  const isCurrent = (interval: TimelineAxisInterval) =>
    interval.start <= todayDay && todayDay <= interval.end;
  const todayPct = parseFloat(pct(todayDay));

  // Daily hairlines only survive at the day zoom. At week/month zoom the
  // canvas shows week and month boundaries instead, so the grid stays quiet.
  // `gridLines` contains every day at week zoom, so it cannot be used as the
  // boundary source there; month/quarter/year gridLines are already buckets.
  const dailyLines = dayWidth >= 32 ? gridLines : [];
  const boundaries = new Set<number>();
  if (dayWidth < 24) for (const day of gridLines) boundaries.add(day);
  for (const interval of axisTop) boundaries.add(interval.start);
  for (const interval of axisBottom) {
    if (interval.daysWide >= 7) boundaries.add(interval.start);
  }
  const boundaryLines = [...boundaries].sort((a, b) => a - b);

  return (
    <>
      <div className="relative h-[49px] cursor-default border-b border-line-subtle bg-surface">
        <div className="relative h-[24px] text-[12px] text-muted">
          {axisTop.map((interval) => {
            const widthPx = interval.daysWide * dayWidth;
            if (widthPx < 28) return null;
            return (
              <span
                key={interval.key}
                data-timeline-axis-row="top"
                data-timeline-axis-interval={interval.key}
                className={`absolute top-1 pl-1 whitespace-nowrap ${
                  isCurrent(interval) ? "font-medium text-text" : "text-muted"
                }`}
                style={{ left: pct(interval.start) }}
              >
                {interval.label}
              </span>
            );
          })}
        </div>
        <div className="relative h-[25px] text-[12px] text-muted">
          {axisBottom.map((interval) => {
            const widthPx = interval.daysWide * dayWidth;
            return (
              <div
                key={`cell-${interval.key}`}
                data-timeline-axis-row="bottom"
                data-timeline-axis-interval={interval.key}
                className="absolute top-0 h-[25px] border-t border-line-subtle"
                style={{ left: pct(interval.start), width: `${interval.daysWide * dayPct}%` }}
              >
                {widthPx >= 28 && (
                  <span
                    className={`absolute top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap ${
                      isCurrent(interval) ? "font-medium text-text" : "text-muted"
                    }`}
                  >
                    {interval.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {showToday && (
          <span
            data-timeline-today-label
            className="pointer-events-none absolute top-[3px] z-20 whitespace-nowrap bg-surface px-0.5 text-[12px] font-medium text-accent-text"
            style={
              todayPct > 88
                ? { left: pct(todayDay), transform: "translateX(-100%)" }
                : { left: `calc(${pct(todayDay)} + 4px)` }
            }
          >
            今日
          </span>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[49px] z-0">
        {showWeekends &&
          dayWidth >= 20 &&
          weekendDays.map((d) => (
            <div
              key={`weekend-${d}`}
              data-timeline-weekend
              className="absolute inset-y-0 bg-surface-subtle"
              style={{ left: pct(d), width: `${dayPct}%` }}
            />
          ))}
        {dailyLines.map((d) => (
          <div
            key={`grid-${d}`}
            data-timeline-grid={d}
            className="absolute inset-y-0 w-px bg-line-subtle/60"
            style={{ left: pct(d) }}
          />
        ))}
        {boundaryLines.map((d) => (
          <div
            key={`boundary-${d}`}
            data-timeline-boundary={d}
            className="absolute inset-y-0 w-px bg-line-subtle"
            style={{ left: pct(d) }}
          />
        ))}
      </div>
    </>
  );
}

export default memo(TimelineAxis);
