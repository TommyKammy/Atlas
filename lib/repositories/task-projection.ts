import type { RichTextDoc } from "../rich-text-types";
import type { TaskRow } from "./projects";
import {
  TASK_SELECT_COLS,
  TASK_TIMELINE_COLS,
  toTaskRow,
} from "./task-select";

/**
 * List/board/calendar read model. Counts and collaborator data are required
 * because grouping, sorting and custom-field columns depend on them.
 */
export type TaskSummary = TaskRow & {
  project_name: string | null;
  like_count: number;
  comment_count: number;
  subtask_count: number;
  attachment_count: number;
  blocked_by_count: number;
  blocking_count: number;
  collaborators: { id: number; name: string }[];
};

/** Timeline read model: dates, marker flags, lane pinning and subtask count. */
export type TaskTimelineRow = TaskRow & {
  subtask_count: number;
  timeline_row: number | null;
  timeline_row_updated_at: string | null;
  eff_section_id: number | null;
};

/** Task-pane read model. Rich text is always present (possibly null). */
export type TaskDetail = TaskRow & {
  description_doc: RichTextDoc | null;
};

export type TaskProjectionKind = "summary" | "timeline" | "detail";

/**
 * Single place mapping a read model to its SQL column list. `summary` and
 * `detail` intentionally share the full projection today, while `timeline`
 * uses the lighter one.
 */
export const TASK_PROJECTIONS: Record<TaskProjectionKind, string> = {
  summary: TASK_SELECT_COLS,
  timeline: TASK_TIMELINE_COLS,
  detail: TASK_SELECT_COLS,
};

export function taskProjection(kind: TaskProjectionKind): string {
  return TASK_PROJECTIONS[kind];
}

export function toTaskSummary(row: TaskRow): TaskSummary {
  return toTaskRow(row) as TaskSummary;
}

export function toTaskTimelineRow(row: TaskRow): TaskTimelineRow {
  return toTaskRow(row) as TaskTimelineRow;
}

export function toTaskDetail(row: TaskRow): TaskDetail {
  return toTaskRow(row) as TaskDetail;
}
