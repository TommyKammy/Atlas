export const DAY_MS = 86_400_000;

/** Parse an ISO YYYY-MM-DD date as a UTC day number. */
export function parseDay(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`invalid date: ${iso}`);
  return Math.floor(t / DAY_MS);
}

/** Format a UTC day number as YYYY-MM-DD. */
export function formatDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function shiftDay(iso: string, delta: number): string {
  return formatDay(parseDay(iso) + delta);
}

/** Week containing the anchor date; start 0 = Sunday, 1 = Monday. */
export function weekAround(anchor: string, start = 0): number[] {
  const day = parseDay(anchor);
  const offset = (new Date(day * DAY_MS).getUTCDay() - start + 7) % 7;
  const first = day - offset;
  return Array.from({ length: 7 }, (_, i) => first + i);
}

/**
 * Weeks covering a calendar month (start 0 = Sunday, 1 = Monday), including
 * the adjacent-month days needed to fill the first and last rows.
 */
export function monthWeeks(month: string, start = 0): number[][] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) throw new Error(`invalid month: ${month}`);
  const first = Date.UTC(y, m - 1, 1) / DAY_MS;
  const last = Date.UTC(y, m, 0) / DAY_MS;
  const lead = (new Date(first * DAY_MS).getUTCDay() - start + 7) % 7;
  const startDay = first - lead;
  const end = last + (6 - ((last - startDay) % 7));
  const weeks: number[][] = [];
  for (let d = startDay; d <= end; d += 7) {
    weeks.push(Array.from({ length: 7 }, (_, i) => d + i));
  }
  return weeks;
}

export type CalendarSpan = {
  id: number;
  start: number;
  end: number;
};

export type WeekBar<T extends CalendarSpan> = {
  item: T;
  colStart: number;
  colEnd: number;
  continuesLeft: boolean;
  continuesRight: boolean;
};

/**
 * Greedy lane packing for range bars in one week. Bars that touch only at a
 * shared day stay in separate lanes because both render on that day.
 */
export function packWeek<T extends CalendarSpan>(
  spans: T[],
  weekStart: number,
  weekEnd: number,
  visibleDays: number[] = [0, 1, 2, 3, 4, 5, 6],
): WeekBar<T>[][] {
  const visibleDates = visibleDays.map((i) => weekStart + i);
  const hits = spans
    .filter(
      (s) =>
        s.start <= weekEnd &&
        s.end >= weekStart &&
        visibleDates.some((d) => d >= s.start && d <= s.end),
    )
    .sort((a, b) => a.start - b.start || b.end - a.end || a.id - b.id);
  const lanes: { end: number; bars: WeekBar<T>[] }[] = [];
  for (const item of hits) {
    const occupied = visibleDates.filter((d) => d >= item.start && d <= item.end);
    if (occupied.length === 0) continue;
    const first = occupied[0];
    const last = occupied[occupied.length - 1];
    let lane = lanes.find((l) => l.end < first);
    if (!lane) {
      lane = { end: -Infinity, bars: [] };
      lanes.push(lane);
    }
    lane.end = last;
    lane.bars.push({
      item,
      colStart: visibleDates.indexOf(first),
      colEnd: visibleDates.indexOf(last),
      continuesLeft: item.start < first,
      continuesRight: item.end > last,
    });
  }
  return lanes.map((l) => l.bars);
}

/** Range for a task's start/due fields; null when neither date is set. */
export function taskSpan(startOn: string | null, dueOn: string | null): { start: number; end: number } | null {
  if (!startOn && !dueOn) return null;
  const a = parseDay(startOn ?? dueOn!);
  const b = parseDay(dueOn ?? startOn!);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
