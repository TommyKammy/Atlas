import { formatDay, parseDay } from "./calendar";

export type TaskDateFields = { start_on?: string; due_on?: string };

/** Pixel delta -> whole-day delta used by calendar pointer drags/resizes. */
export function pixelsToDayDelta(dx: number, dayWidth: number): number {
  return Math.round(dx / Math.max(1, dayWidth));
}

/** Safe ISO -> UTC day number. */
export function dayOrNull(iso: string | null | undefined): number | null {
  if (!iso) return null;
  try {
    return parseDay(iso);
  } catch {
    return null;
  }
}

export function taskDaySpan(task: {
  start_on: string | null;
  due_on: string | null;
}): { start: number; end: number } | null {
  const start = dayOrNull(task.start_on ?? task.due_on);
  const end = dayOrNull(task.due_on ?? task.start_on);
  if (start === null || end === null) return null;
  return { start, end };
}

/** Shift a task's span by whole days, preserving duration. */
export function moveTaskSpan(
  task: { start_on: string | null; due_on: string | null },
  deltaDays: number,
): TaskDateFields | null {
  const span = taskDaySpan(task);
  if (!span) return null;
  return { start_on: formatDay(span.start + deltaDays), due_on: formatDay(span.end + deltaDays) };
}

/** Resize the start edge, clamped so it never passes the due date. */
export function resizeTaskStart(
  task: { start_on: string | null; due_on: string | null },
  deltaDays: number,
): TaskDateFields | null {
  const span = taskDaySpan(task);
  if (!span) return null;
  const start = Math.min(span.end, span.start + deltaDays);
  return { start_on: formatDay(start), due_on: formatDay(span.end) };
}

/** Resize the due edge, clamped so it never passes the start date. */
export function resizeTaskEnd(
  task: { start_on: string | null; due_on: string | null },
  deltaDays: number,
): TaskDateFields | null {
  const span = taskDaySpan(task);
  if (!span) return null;
  const end = Math.max(span.start, span.end + deltaDays);
  return { start_on: formatDay(span.start), due_on: formatDay(end) };
}

/**
 * Drop a task on a calendar day. Multi-day spans keep their duration and move
 * the due date to the drop target; single-day tasks replace the date.
 */
export function dropTaskOnDate(
  task: { start_on: string | null; due_on: string | null },
  dateISO: string,
  keepDuration = true,
): TaskDateFields | null {
  const target = dayOrNull(dateISO);
  if (target === null) return null;
  const span = taskDaySpan(task);
  if (keepDuration && span && span.end > span.start) {
    const duration = span.end - span.start;
    return { start_on: formatDay(target - duration), due_on: dateISO };
  }
  if (task.start_on) return { start_on: dateISO, due_on: dateISO };
  return { due_on: dateISO };
}
