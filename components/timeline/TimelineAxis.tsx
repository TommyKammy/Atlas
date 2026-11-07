"use client";

export type TimelineAxisInterval = {
  key: string;
  start: number;
  end: number;
  label: string;
  daysWide: number;
};

export default function TimelineAxis({
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
  return (
    <>
      <div className="relative h-[49px] cursor-default border-b border-[#e1e1e1] bg-white">
        <div className="relative h-[24px] text-xs text-neutral-600">
          {axisTop.map((interval) => {
            const widthPx = interval.daysWide * dayWidth;
            if (widthPx < 28) return null;
            return (
              <span
                key={interval.key}
                data-timeline-axis-row="top"
                data-timeline-axis-interval={interval.key}
                className="absolute top-1 pl-1"
                style={{ left: pct(interval.start) }}
              >
                {interval.label}
              </span>
            );
          })}
        </div>
        <div className="relative h-[25px] text-[11px] text-neutral-500">
          {axisBottom.map((interval) => {
            const widthPx = interval.daysWide * dayWidth;
            return (
              <div
                key={`cell-${interval.key}`}
                data-timeline-axis-row="bottom"
                data-timeline-axis-interval={interval.key}
                className="absolute top-0 h-[25px] border-t border-[#eaeaea]"
                style={{ left: pct(interval.start), width: `${interval.daysWide * dayPct}%` }}
              >
                {widthPx >= 28 && (
                  <span className="absolute top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                    {interval.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {showToday && (
          <span
            className="pointer-events-none absolute z-20 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#2c60b8]"
            style={{ left: pct(todayDay), top: 22 }}
            title="今日"
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[49px] z-0">
        {showWeekends &&
          dayWidth >= 20 &&
          weekendDays.map((d) => (
            <div
              key={`weekend-${d}`}
              data-timeline-weekend
              className="absolute inset-y-0 bg-[#eaeaea]"
              style={{ left: pct(d), width: `${dayPct}%` }}
            />
          ))}
        {gridLines.map((d) => (
          <div
            key={`grid-${d}`}
            data-timeline-grid={d}
            className="absolute inset-y-0 w-px bg-[#eaeaea]"
            style={{ left: pct(d) }}
          />
        ))}
      </div>
    </>
  );
}
