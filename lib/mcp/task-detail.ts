import type { TaskDetailView } from "@/lib/services/queries";

/** Maximum task description characters returned by get_task by default. */
export const TASK_DESCRIPTION_LIMIT = 2_000;

/** Bounded task detail payload shared by get_task and the task write tools. */
export function taskDetailPayload(
  detail: TaskDetailView,
  includeFullDescription = false,
): { output: Record<string, unknown>; truncated: boolean } {
  const description = typeof detail.task.description === "string"
    ? detail.task.description
    : "";
  const truncated = !includeFullDescription && description.length > TASK_DESCRIPTION_LIMIT;
  const task: Record<string, unknown> = { ...detail.task };
  // The rich-text document duplicates the plain description and can be much
  // larger than the 2,000-character MCP budget.
  delete task.description_doc;
  task.description = truncated ? description.slice(0, TASK_DESCRIPTION_LIMIT) : description;
  return {
    output: {
      task,
      project: detail.project,
      section: detail.section,
      parent: detail.parent,
      customFieldValues: detail.customFieldValues,
      description_truncated: truncated,
    },
    truncated,
  };
}
