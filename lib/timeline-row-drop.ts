import { TIMELINE_AXIS_HEIGHT, TIMELINE_ROW_PITCH } from "./timeline-metrics";

export type TimelineRowDropGroup = {
  sectionId: number | null;
  top: number;
  height: number;
  laneCount: number;
  collapsed: boolean;
};

export type TimelineRowDrop = {
  sectionId: number | null;
  row: number;
  top: number;
  insert?: boolean;
};

const MAX_PINNED_ROW = 200;

/** Resolve a canvas-relative drop against groups in their displayed order. */
export function resolveTimelineRowDrop(
  groups: readonly TimelineRowDropGroup[],
  y: number,
  contentHeight: number,
): TimelineRowDrop | null {
  if (!Number.isFinite(y) || !Number.isFinite(contentHeight) ||
      y < TIMELINE_AXIS_HEIGHT || y > contentHeight) return null;

  const last = groups.at(-1);
  const group = groups.find((entry) => y >= entry.top && y < entry.top + entry.height) ??
    (last && y >= last.top + last.height ? last : undefined);
  if (!group) return null;

  const maxRow = Math.min(MAX_PINNED_ROW, Math.max(0, group.laneCount));
  // Keep every pixel inside a section in its visible row. An invisible append
  // strip put the preview in the NEXT section while still targeting this one.
  // Only the blank canvas below the final group can append outside a group.
  const append = y >= group.top + group.height;
  const row = group.collapsed ? 0 : append ? maxRow :
    Math.min(maxRow, Math.max(0, Math.floor((y - group.top) / TIMELINE_ROW_PITCH)));
  return { sectionId: group.sectionId, row, top: group.top + row * TIMELINE_ROW_PITCH };
}


export type TimelineRowPlacement = {
  task_id: number;
  row_index: number;
  expected_updated_at: string | null;
  expected_task_updated_at: string;
};

type TaskDropGroup = TimelineRowDropGroup & {
  laneById: ReadonlyMap<number, number>;
  intervalsById: ReadonlyMap<number, { start: number; end: number }>;
  occupantsByLane: ReadonlyMap<number, readonly number[]>;
};

/** Hit-test the rendered insertion gap, then the stable pre-drag row layout. */
export function resolveTimelineTaskDrop(
  groups: readonly TaskDropGroup[], y: number, contentHeight: number,
  taskId: number, previous: TimelineRowDrop | null, dateDelta = 0,
): TimelineRowDrop | null {
  if (previous?.insert) {
    const expanded = groups.find((group) => group.sectionId === previous.sectionId);
    if (expanded) {
      const end = expanded.top + expanded.height;
      // Keep hit positions within the section stable while its peers make
      // room. Otherwise crossing a bar's upper half opens a gap that traps
      // the pointer and makes reaching its lower half require chasing it.
      if (y >= end + TIMELINE_ROW_PITCH) y -= TIMELINE_ROW_PITCH;
      else if (y >= end) y = end - 0.001;
    }
  }
  const drop = resolveTimelineRowDrop(groups, y, contentHeight);
  if (!drop) return null;
  const group = groups.find((g) => g.sectionId === drop.sectionId)!;
  const source = groups.find((g) => g.intervalsById.has(taskId));
  const interval = source?.intervalsById.get(taskId);
  const collision = interval && (group.occupantsByLane.get(drop.row) ?? []).some((id) => {
    const other = group.intervalsById.get(id)!;
    return id !== taskId && interval.start + dateDelta <= other.end && other.start <= interval.end + dateDelta;
  });
  if (!collision) return drop;
  const row = drop.row + (y - drop.top >= TIMELINE_ROW_PITCH / 2 ? 1 : 0);
  // Inserting shifts peers too. Never send an out-of-range plan to the API.
  if (row > MAX_PINNED_ROW || [...group.laneById].some(([id, lane]) => id !== taskId && lane >= row && lane >= MAX_PINNED_ROW)) return null;
  return { sectionId: drop.sectionId, row, top: group.top + row * TIMELINE_ROW_PITCH, insert: true };
}
