import type { ActionCapabilityId } from "../automation/descriptors";
import { projectSetStatus } from "./project-set-status";
import type { CapabilityContext, CapabilityResult } from "./shared";
import { taskAddComment } from "./task-add-comment";
import { taskAddToProject } from "./task-add-to-project";
import { taskAssign } from "./task-assign";
import { taskComplete } from "./task-complete";
import { taskCreate } from "./task-create";
import { taskCreateSubtask } from "./task-create-subtask";
import { taskMoveSection } from "./task-move-section";
import { taskSetCustomField } from "./task-set-custom-field";
import { taskSetDueDate } from "./task-set-due-date";
import { taskSetStatus } from "./task-set-status";
import { webhookPost } from "./webhook-post";

type CapabilityHandler = (params: Record<string, unknown>, ctx: CapabilityContext) => Promise<CapabilityResult>;

/** Server-only executors; descriptors stay safe to import from client code. */
export const CAPABILITY_HANDLERS = {
  "task.assign": taskAssign,
  "task.set_status": taskSetStatus,
  "task.set_due_date": taskSetDueDate,
  "task.move_section": taskMoveSection,
  "task.complete": taskComplete,
  "task.add_comment": taskAddComment,
  "task.create": taskCreate,
  "task.create_subtask": taskCreateSubtask,
  "task.set_custom_field": taskSetCustomField,
  "project.set_status": projectSetStatus,
  "task.add_to_project": taskAddToProject,
  "webhook.post": webhookPost,
} satisfies Record<ActionCapabilityId, CapabilityHandler>;
