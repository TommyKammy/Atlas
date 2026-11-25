import { z } from "zod";
import { taskDetailPayload } from "./task-detail";
import { defineTool, TASK_REF_NOTE, taskRefSchema, text, UNTRUSTED_DATA_NOTE, type McpToolDefinition } from "./tool-definition";
import { beginWrite, expectedUpdatedAtSchema, writeAnnotations, type McpWriteServices } from "./write-tool";

/** start_task (docs/dev-projects-phase0.md §6.2). */
export function createStartTaskTool(services: McpWriteServices): McpToolDefinition {
  return defineTool({
    name: "start_task",
    title: "Start task",
    description:
      "Start work on an issue in a development project: assign it to you when it has no "
      + "assignee and move its status to the project's start status (dev.start_status) when "
      + "the current status comes before it. Requires edit access to the task's project. "
      + "Returns the task, its key, branch_name (use it for your working branch) and changed "
      + "({ assignee, status, reopened }). Safe to repeat: a second call changes and records "
      + "nothing. Fails without changes, with reason conflict and one of these conflict "
      + "values: not_dev_project, assigned_to_other (the current assignee is returned), "
      + "completed (pass reopen: true to reopen the issue and move it to the start status), "
      + "recurring_completed, approval_task or task_moved. Pass expected_updated_at to fail "
      + "instead of overwriting a concurrent change. "
      + TASK_REF_NOTE + " "
      + UNTRUSTED_DATA_NOTE,
    requiredScope: "write",
    annotations: writeAnnotations({ idempotent: true }),
    inputSchema: z.object({
      task: taskRefSchema,
      reopen: z.boolean().optional(),
      expected_updated_at: expectedUpdatedAtSchema,
    }),
    handler: async (args, ctx) => {
      await beginWrite(services, ctx);
      const taskId = await services.resolveTaskRef(ctx.actor, args.task, "view");
      const started = await services.startTask(ctx.actor, taskId, {
        reopen: args.reopen,
        expectedUpdatedAt: args.expected_updated_at,
      });
      const detail = await services.getTaskDetail(ctx.actor, taskId);
      const { output } = taskDetailPayload(detail);
      const { changed } = started;
      const summary = [
        changed.assignee ? "assigned to you" : null,
        changed.reopened ? "reopened" : null,
        changed.status ? `status set to ${detail.task.status}` : null,
      ].filter(Boolean);
      return {
        structuredContent: {
          ...output,
          key: started.key,
          branch_name: started.branchName,
          changed,
        },
        content: text(
          `Task ${started.key} (id ${taskId}) `
          + (summary.length > 0 ? `started: ${summary.join(", ")}.` : "was already started; nothing changed.")
          + ` Branch: ${started.branchName}.`,
        ),
      };
    },
  });
}
