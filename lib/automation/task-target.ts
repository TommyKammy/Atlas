import type { DomainEventType } from "../domain/events";

const TASK_SUBJECT_EVENTS = new Set<DomainEventType>([
  "task.created",
  "task.completed",
  "task.reopened",
  "task.assigned",
  "task.status_changed",
  "task.due_changed",
  "task.section_changed",
  "task.custom_field_changed",
  "task.milestone_changed",
  "task.added_to_project",
  "task.deleted",
  "comment.created",
  "comment.updated",
  "form.submitted",
  "task.due_soon",
  "task.overdue",
  "task.manual_rule",
]);

export function hasTaskSubject(event: DomainEventType): boolean {
  return TASK_SUBJECT_EVENTS.has(event);
}

/** Only literal IDs may supply a task target for a non-task event. */
export function configuredTaskId(value: unknown): number | null {
  const id = typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}
