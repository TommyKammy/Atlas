"use client";

import type { ReactNode } from "react";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export default function CalendarGrid({
  weekMode,
  cols,
  weekdayOrder,
  visibleDays,
  children,
}: {
  weekMode: boolean;
  cols: string;
  weekdayOrder: number[];
  visibleDays: number[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-b-md border-l border-t border-line">
      <div className="flex min-h-full min-w-[720px] flex-col">
        {!weekMode && (
          <div
            className="sticky top-0 z-20 grid border-b border-line bg-surface-subtle"
            style={{ gridTemplateColumns: cols }}
          >
            {weekdayOrder.map((weekday, offset) =>
              visibleDays.includes(offset) ? (
                <div
                  key={weekday}
                  className={`flex h-6 items-center border-r border-line px-2 text-[11px] font-medium text-muted ${
                    weekday === 0 || weekday === 6 ? "justify-center px-0" : ""
                  }`}
                >
                  {weekday === 0 || weekday === 6 ? "" : WEEKDAYS[weekday]}
                </div>
              ) : null,
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
