import type { TaskRow } from "./repositories/projects";

/** The timeline, its filters and its context menu share this read model. */
export type TaskTimelineRow = Pick<TaskRow,
  "id" | "project_id" | "section_id" | "name" | "assignee_id" | "assignee_name" |
  "created_by" | "completed" | "completed_at" | "start_on" | "due_on" | "progress" |
  "status" | "is_milestone" | "position" | "created_at" | "updated_at" | "subtask_count" | "approval"
> & {
  parent_task_id: null;
  eff_section_id: number | null;
  timeline_row: number | null;
  timeline_row_updated_at: string | null;
};

/** Positional transport keeps repeated field names out of the RSC response. */
export type TimelineTaskPayload = [
  id: number, projectId: number | null, sectionId: number | null, name: string,
  assigneeId: number | null, assigneeName: string | null, creatorId: number | null,
  completed: boolean, completedAt: string | null, startOn: string | null, dueOn: string | null,
  progress: number, status: string, milestone: boolean, position: number,
  createdAt: string, updatedAt: string, subtaskCount: number,
  effectiveSectionId: number | null, rowIndex: number | null, rowUpdatedAt: string | null,
  approval?: TaskRow["approval"],
];

export function decodeTimelineTask([
  id, project_id, section_id, name, assignee_id, assignee_name, created_by,
  completed, completed_at, start_on, due_on, progress, status, is_milestone, position,
  created_at, updated_at, subtask_count, eff_section_id, timeline_row, timeline_row_updated_at,
  approval,
]: TimelineTaskPayload): TaskTimelineRow {
  return {
    id, project_id, section_id, parent_task_id: null, name, assignee_id, assignee_name, created_by,
    completed, completed_at, start_on, due_on, progress, status, is_milestone, position,
    created_at, updated_at, subtask_count, eff_section_id, timeline_row, timeline_row_updated_at,
    ...(approval ? { approval } : {}),
  };
}
