import { dayOrNull } from "./task-dates";

export type TimelineLaneInterval = {
  id: number;
  start: number;
  end: number;
  /**
   * Optional visual end in day units (e.g. the external label of a skinny
   * task). Lane packing uses max(end, visualEnd).
   */
  visualEnd?: number;
  /** Pinned row index. null/undefined means auto-packed. */
  pinnedRow?: number | null;
};

export type TimelineLaneTask = {
  id: number;
  start_on: string | null;
  due_on: string | null;
  is_milestone: boolean;
};

/**
 * Approximate the external label footprint of a skinny task/milestone in day
 * units. Used to avoid label collisions at coarse zoom levels.
 */
export function estimateTimelineLabelDays(name: string, dayWidth: number, extraPx = 0): number {
  const textWidth = [...name].reduce(
    (width, char) => width + (char.charCodeAt(0) > 0x2e80 ? 12 : 7),
    0,
  );
  const labelPx = Math.min(172, 16 + textWidth + extraPx) + 8;
  return labelPx / Math.max(1, dayWidth);
}

/**
 * Effective inclusive day interval for lane packing. Milestones occupy only
 * their due date (or start date when no due date is set).
 */
export function timelineInterval(task: TimelineLaneTask): { start: number; end: number } | null {
  const milestoneDay = task.is_milestone
    ? (dayOrNull(task.due_on) ?? dayOrNull(task.start_on))
    : null;
  const start = milestoneDay ?? dayOrNull(task.start_on) ?? dayOrNull(task.due_on);
  const end = milestoneDay ?? dayOrNull(task.due_on) ?? dayOrNull(task.start_on);
  if (start === null || end === null) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

type Normalized = {
  id: number;
  start: number;
  end: number;
  pinnedRow: number | null;
};

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Greedy interval partitioning with optional pinned rows.
 *
 * - Pinned tasks start at their preferred row and move down on collision.
 *   Auto tasks take the lowest row that does not
 *   overlap any pinned or already-placed auto task.
 * - Rows are allowed to be empty. The section height is derived from the
 *   highest used row.
 * - Auto tasks are sorted by start/end/id for deterministic results.
 * - The overlap set remains empty: even legacy colliding pins are separated.
 */
export function assignTimelineLanes(items: TimelineLaneInterval[]): {
  laneById: Map<number, number>;
  laneCount: number;
  overlappingIds: Set<number>;
} {
  const normalized: Normalized[] = items
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .map((item) => ({
      id: item.id,
      start: Math.min(item.start, item.end),
      end: Math.max(item.start, item.end, item.visualEnd ?? item.end),
      pinnedRow:
        typeof item.pinnedRow === "number" && Number.isInteger(item.pinnedRow) && item.pinnedRow >= 0
          ? item.pinnedRow
          : null,
    }));

  const laneById = new Map<number, number>();
  const rowIntervals = new Map<number, { id: number; start: number; end: number }[]>();
  const overlappingIds = new Set<number>();
  let maxRow = -1;

  const push = (row: number, entry: Normalized) => {
    const list = rowIntervals.get(row) ?? [];
    list.push({ id: entry.id, start: entry.start, end: entry.end });
    rowIntervals.set(row, list);
    maxRow = Math.max(maxRow, row);
  };

  // Pins express a preferred row, never permission to hide another bar.
  // Stable ordering also repairs legacy overlapping pins without DB writes.
  const pinned = normalized.filter((item) => item.pinnedRow !== null)
    .sort((a, b) => a.pinnedRow! - b.pinnedRow! || a.id - b.id);
  for (const item of pinned) {
    let row = item.pinnedRow!;
    while ((rowIntervals.get(row) ?? []).some((entry) => overlaps(entry, item))) row++;
    push(row, item);
    laneById.set(item.id, row);
  }

  const auto = normalized
    .filter((item) => item.pinnedRow === null)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);

  for (const item of auto) {
    let row = 0;
    for (; row <= maxRow + 1; row++) {
      const list = rowIntervals.get(row) ?? [];
      if (list.every((entry) => !overlaps(entry, item))) break;
    }
    push(row, item);
    laneById.set(item.id, row);
  }

  return {
    laneById,
    laneCount: maxRow + 1,
    overlappingIds,
  };
}
