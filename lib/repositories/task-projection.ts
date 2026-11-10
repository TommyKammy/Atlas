import type { RichTextDoc } from "../rich-text-types";
import type { TaskTimelineRow, TimelineTaskPayload } from "../timeline-task-payload";
import type { TaskRow } from "./projects";
import {
  TASK_SELECT_COLS,
  TASK_TIMELINE_COLS,
  taskSelectColumns,
  taskTimelineColumns,
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

export function taskProjection(kind: TaskProjectionKind, project?: string): string {
  if (!project) return TASK_PROJECTIONS[kind];
  return kind === "timeline" ? taskTimelineColumns(project) : taskSelectColumns(project);
}

export function toTaskSummary(row: TaskRow): TaskSummary {
  return toTaskRow(row) as TaskSummary;
}

const nullableNumber = (value: number | null) => value === null ? null : Number(value);

export function toTimelineTaskPayload(row: Omit<TaskTimelineRow, "parent_task_id">): TimelineTaskPayload {
  const payload: TimelineTaskPayload = [
    Number(row.id), nullableNumber(row.project_id), nullableNumber(row.section_id), row.name,
    nullableNumber(row.assignee_id), row.assignee_name, nullableNumber(row.created_by),
    row.completed, row.completed_at, row.start_on, row.due_on, Number(row.progress), row.status,
    row.is_milestone === true, Number(row.position), row.created_at, row.updated_at,
    Number(row.subtask_count ?? 0), nullableNumber(row.eff_section_id),
    nullableNumber(row.timeline_row), row.timeline_row_updated_at,
  ];
  // Ordinary tasks keep the existing compact wire format.
  if (row.approval) payload.push(row.approval);
  return payload;
}

export function toTaskDetail(row: TaskRow): TaskDetail {
  return toTaskRow(row) as TaskDetail;
}
