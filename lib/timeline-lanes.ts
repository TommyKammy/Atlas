import { dayOrNull } from "./task-dates";

export type TimelineLaneInterval = {
  id: number;
  start: number;
  end: number;
};

export type TimelineLaneTask = {
  id: number;
  start_on: string | null;
  due_on: string | null;
  is_milestone: boolean;
};

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

/**
 * Greedy interval partitioning. Tasks whose inclusive date ranges do not
 * overlap share the lowest available lane. Sorting by start/end/id keeps the
 * result deterministic regardless of the list's manual position order.
 */
export function assignTimelineLanes(items: TimelineLaneInterval[]): {
  laneById: Map<number, number>;
  laneCount: number;
} {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id - b.id,
  );
  const laneEnds: number[] = [];
  const laneById = new Map<number, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end < item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    laneById.set(item.id, lane);
  }
  return { laneById, laneCount: laneEnds.length };
}
