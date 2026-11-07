"use client";

import { formatDay } from "@/lib/calendar";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export default function CalendarDayHeader({
  day,
  weekView,
  month,
  today,
  onAdd,
}: {
  day: number;
  weekView: boolean;
  month: string;
  today: string;
  onAdd: (iso: string) => void;
}) {
  const iso = formatDay(day);
  const dt = new Date(day * 86_400_000);
  const idx = dt.getUTCDay();
  const compact = idx === 0 || idx === 6;
  const sameMonth = iso.slice(0, 7) === month;
  const isToday = iso === today;
  return (
    <div
      data-day-header={iso}
      className={`group/day overflow-hidden border-r border-b border-neutral-200 bg-white ${
        weekView ? "flex h-[70px] flex-col px-2 py-2" : "flex h-7 items-center px-1.5"
      } ${compact ? "items-center" : ""}`}
    >
      {weekView ? (
        <>
          <div className={`flex items-center gap-1 ${compact ? "text-[10px]" : "text-xs"}`}>
            <span className={compact ? "text-neutral-400" : "text-neutral-500"}>{WEEKDAYS[idx]}</span>
            <span
              className={`inline-flex items-center justify-center font-normal ${
                isToday
                  ? "h-7 min-w-7 rounded-lg bg-[#4075cf] px-1 text-[14px] text-white"
                  : `text-[14px] ${sameMonth ? "text-neutral-900" : "text-neutral-400"}`
              }`}
            >
              {dt.getUTCDate()}
            </span>
          </div>
          {!compact && (
            <button
              type="button"
              onClick={() => onAdd(iso)}
              className="mt-0.5 flex h-5 w-fit items-center rounded px-1 text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
            >
              ＋ タスクを追加
            </button>
          )}
        </>
      ) : (
        <span
          className={`inline-flex items-center justify-center text-xs ${
            isToday
              ? "h-6 min-w-6 rounded-md bg-[#4075cf] px-1 font-medium text-white"
              : sameMonth
                ? "text-neutral-600"
                : "text-neutral-400"
          }`}
        >
          {sameMonth || compact ? dt.getUTCDate() : `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日`}
        </span>
      )}
    </div>
  );
}
