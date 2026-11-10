import { DAY_MS, parseDay } from "./calendar";

export const ZOOM_PRESETS = [
  { key: "hour", label: "時間", dayWidth: 5064, maxDays: 31 },
  { key: "day", label: "日", dayWidth: 40, maxDays: 548 },
  { key: "week", label: "週", dayWidth: 24, maxDays: 1827 },
  { key: "month", label: "月", dayWidth: 12, maxDays: 3653 },
  { key: "quarter", label: "四半期", dayWidth: 4, maxDays: 14610 },
  { key: "half", label: "半年", dayWidth: 2, maxDays: 36525 },
  { key: "year", label: "年", dayWidth: 1, maxDays: 36525 },
] as const;

export type TimelineZoomPreset = (typeof ZOOM_PRESETS)[number];

export type TimelineAxisInterval = {
  key: string;
  start: number;
  end: number;
  label: string;
  daysWide: number;
};

const utcDate = (day: number) => new Date(day * DAY_MS);
const firstDayOfWeek = (day: number) => day - utcDate(day).getUTCDay();
const firstDate = parseDay("0001-01-01");
const lastDate = parseDay("9999-12-31");

export function clampTimelineDay(day: number): number {
  return Math.max(firstDate, Math.min(day, lastDate));
}

export function timelineDateWindow(
  min: number,
  max: number,
  startOverride: number | null,
  anchor: number | null,
  today: number,
  { dayWidth, maxDays }: TimelineZoomPreset,
) {
  const desiredSpan = Math.ceil(1680 / dayWidth);
  if (startOverride !== null) {
    min = clampTimelineDay(startOverride);
    if (max < min) max = min + 30;
    max = Math.max(max, min + desiredSpan - 1);
  } else {
    const extra = Math.max(0, desiredSpan - (max - min + 1));
    const before = Math.floor(extra / 2);
    min -= before;
    max += extra - before;
  }
  min = clampTimelineDay(min);
  max = clampTimelineDay(max);
  const limited = max - min + 1 > maxDays;
  if (limited) {
    if (startOverride === null || anchor !== null) {
      const center = Math.floor(anchor ?? today);
      min = Math.max(min, Math.min(center - Math.floor(maxDays / 2), max - maxDays + 1));
    }
    max = min + maxDays - 1;
  }
  return { min, max, navigationDays: limited ? maxDays : 30 };
}

function interval(key: string, start: number, end: number, label: string): TimelineAxisInterval {
  return { key, start, end, label, daysWide: end - start + 1 };
}

function weekLabel(start: number): string {
  const a = utcDate(start);
  const b = utcDate(start + 6);
  const range = a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} - ${b.getUTCDate()}`
    : `${a.getUTCMonth() + 1}月${a.getUTCDate()}日 - ${b.getUTCDate()}`;
  // The week starts on Sunday in the UI. Its ISO number comes from Monday.
  const thursday = utcDate(start + 4);
  const yearStart = new Date(thursday);
  yearStart.setUTCMonth(0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `W${week} ${range}`;
}

function calendarIntervals(min: number, max: number, months: 1 | 3 | 12) {
  const result: TimelineAxisInterval[] = [];
  for (let day = min; day <= max;) {
    const date = utcDate(day);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const quarter = Math.floor(month / 3) + 1;
    const key = months === 12 ? `${year}` : months === 3 ? `${year}-Q${quarter}` : `${year}-${month}`;
    const label = months === 12 ? `${year}年` : months === 3 ? `Q${quarter}` : `${month + 1}月`;
    date.setUTCMonth(month - (month % months) + months, 1);
    const next = date.getTime() / DAY_MS;
    result.push(interval(key, day, Math.min(next - 1, max), label));
    day = next;
  }
  return result;
}

/** Build only the axis rows and grid that the current zoom displays. */
export function buildTimelineAxis(min: number, max: number, zoom: TimelineZoomPreset["key"]) {
  const weekendDays: number[] = [];
  const gridLines: number[] = [];
  if (zoom === "hour") {
    const axisTop: TimelineAxisInterval[] = [];
    const axisBottom: TimelineAxisInterval[] = [];
    for (let day = min; day <= max; day++) {
      const date = utcDate(day);
      axisTop.push(interval(`${day}`, day, day, `${date.getUTCMonth() + 1}/${date.getUTCDate()}`));
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) weekendDays.push(day);
      for (let hour = 0; hour < 24; hour++) {
        const start = day + hour / 24;
        axisBottom.push({
          key: `${day}-${hour}`,
          start,
          end: day + (hour + 1) / 24,
          label: `${hour}:00`,
          daysWide: 1 / 24,
        });
        if (hour > 0) gridLines.push(start);
      }
    }
    return { axisTop, axisBottom, weekendDays, gridLines };
  }
  if (zoom === "day" || zoom === "week") {
    const axisTop = calendarIntervals(min, max, 1);
    const axisBottom: TimelineAxisInterval[] = [];
    for (let day = min; day <= max; day++) {
      const date = utcDate(day);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) weekendDays.push(day);
      gridLines.push(day);
      if (zoom === "day") axisBottom.push(interval(`${day}`, day, day, `${date.getUTCDate()}`));
    }
    if (zoom === "week") {
      for (let day = firstDayOfWeek(min); day <= max; day += 7) {
        axisBottom.push(interval(`w-${day}`, Math.max(day, min), Math.min(day + 6, max), weekLabel(day)));
      }
    }
    return { axisTop, axisBottom, weekendDays, gridLines };
  }
  const axisTop = calendarIntervals(min, max, 12);
  const axisBottom = calendarIntervals(min, max, zoom === "month" || zoom === "quarter" ? 1 : 3);
  if (zoom === "month") {
    for (let day = firstDayOfWeek(min + 6); day <= max; day += 7) gridLines.push(day);
  } else {
    for (const bucket of axisBottom) gridLines.push(bucket.start);
  }
  return { axisTop, axisBottom, weekendDays, gridLines };
}
