import { z } from "zod";
import { badRequest } from "@/lib/api/errors";
import type { TaskDetailView } from "@/lib/services/queries";
import { TaskMutationFailure } from "@/lib/services/task-mutation-failure";
import { TASK_DESCRIPTION_LIMIT, taskDetailPayload } from "./task-detail";
import { defineTool, idSchema, text, UNTRUSTED_DATA_NOTE, type McpToolDefinition } from "./tool-definition";
import {
  beginWrite, expectedUpdatedAtSchema, failedUpdate, idempotencyKeySchema, nullableDateSchema,
  writeResultAnnotations, type FailedUpdate, type McpWriteServices,
} from "./write-tool";

const nullableIdSchema = z.union([idSchema, z.null()]).optional();

function resolveAssigneeId(
  assignee: "me" | number | null | undefined,
  uid: number,
): number | null | undefined {
  if (assignee === undefined) return undefined;
  return assignee === "me" ? uid : assignee;
}

export function createSaveTaskTool(services: McpWriteServices): McpToolDefinition {
  const saveTaskSchema = z.object({
    id: idSchema.optional(),
    project_id: idSchema.optional(),
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(50_000).optional(),
    assignee: z.union([z.literal("me"), idSchema, z.null()]).optional(),
    start_on: nullableDateSchema,
    due_on: nullableDateSchema,
    status: z.string().min(1).max(64).optional(),
    section_id: nullableIdSchema,
    parent_task_id: nullableIdSchema,
    is_milestone: z.boolean().optional(),
    custom_fields: z.array(z.object({
      field_id: idSchema,
      value: z.unknown(),
    })).max(100).optional(),
    expected_updated_at: expectedUpdatedAtSchema,
    idempotency_key: idempotencyKeySchema,
  });

  return defineTool({
    name: "save_task",
    title: "Save task",
    description:
      "Create a task when id is omitted, or update the task with that id. Creation requires "
      + "edit access to project_id; updates require edit access to the task's project. On "
      + "creation, pass idempotency_key to avoid creating duplicates when a request is retried. "
      + "On update, only supplied fields change; pass expected_updated_at from a previous read "
      + "to fail instead of overwriting a concurrent change. assignee accepts \"me\", a user id, "
      + "or null to clear it. custom_fields are applied one field at a time. When moving a task "
      + "to another project together with custom_fields, the task update runs first, so a later "
      + "conflict can report task_updated with the fields already applied. Returns the latest "
      + "task detail. "
      + UNTRUSTED_DATA_NOTE,
    requiredScope: "write",
    annotations: writeResultAnnotations,
    inputSchema: saveTaskSchema,
    handler: async (args, ctx) => {
      const tokenId = await beginWrite(services, ctx);
      const assigneeId = resolveAssigneeId(args.assignee, ctx.actor.uid);

      if (args.id === undefined) {
        if (args.name === undefined || args.name.trim() === "") throw badRequest("name is required");
        if (args.project_id === undefined) throw badRequest("project_id is required");
        const createInput: Record<string, unknown> = {
          project_id: args.project_id,
          name: args.name,
        };
        if (args.section_id !== undefined) createInput.section_id = args.section_id;
        if (args.parent_task_id !== undefined) createInput.parent_task_id = args.parent_task_id;
        if (args.start_on !== undefined) createInput.start_on = args.start_on;
        if (args.due_on !== undefined) createInput.due_on = args.due_on;
        if (assigneeId !== undefined) createInput.assignee_id = assigneeId;
        if (args.is_milestone !== undefined) createInput.is_milestone = args.is_milestone;

        return services.withIdempotency(
          { tokenId, toolName: "save_task", key: args.idempotency_key, args },
          async () => {
            const created = await services.createTask(ctx.actor, createInput);
            const failedUpdates: FailedUpdate[] = [];
            const afterCreate: Record<string, unknown> = {};
            if (args.description !== undefined) afterCreate.description = args.description;
            if (args.status !== undefined) afterCreate.status = args.status;
            if (Object.keys(afterCreate).length > 0) {
              try {
                await services.updateTaskForActor(ctx.actor, created.id, afterCreate);
              } catch (error) {
                for (const field of Object.keys(afterCreate)) {
                  failedUpdates.push(failedUpdate("save_task", field, error));
                }
              }
            }
            for (const field of args.custom_fields ?? []) {
              try {
                await services.setTaskCustomValue(ctx.actor, {
                  task_id: created.id,
                  field_id: field.field_id,
                  value: field.value,
                });
              } catch (error) {
                failedUpdates.push(
                  failedUpdate("save_task", `custom_fields.${field.field_id}`, error),
                );
              }
            }
            let detail: TaskDetailView | null = null;
            try {
              detail = await services.getTaskDetail(ctx.actor, created.id);
            } catch (error) {
              failedUpdates.push(failedUpdate("save_task", "task_detail", error));
            }
            if (failedUpdates.length > 0 || detail === null) {
              if (detail === null && failedUpdates.length === 0) {
                failedUpdates.push({ field: "task_detail", error: "task detail unavailable" });
              }
              return {
                structuredContent: {
                  created: true,
                  id: created.id,
                  task: detail ? taskDetailPayload(detail).output.task : { id: created.id },
                  failed_updates: failedUpdates,
                },
                content: text(
                  `Created task ${created.id}, but some fields could not be applied. `
                  + `Retry them with save_task using id ${created.id}.`,
                ),
                isError: true,
              };
            }
            const { output, truncated } = taskDetailPayload(detail);
            return {
              structuredContent: output,
              content: text(
                `Created task ${created.id}: ${detail.task.name}.`
                + (truncated ? ` Description truncated at ${TASK_DESCRIPTION_LIMIT} characters.` : ""),
              ),
            };
          },
        );
      }

      const taskId = args.id;
      const callerStamp = args.expected_updated_at;
      const hasExpectedStamp = callerStamp !== undefined;
      const patch: Record<string, unknown> = {};
      if (args.project_id !== undefined) patch.project_id = args.project_id;
      if (args.name !== undefined) patch.name = args.name;
      if (args.description !== undefined) patch.description = args.description;
      if (args.start_on !== undefined) patch.start_on = args.start_on;
      if (args.due_on !== undefined) patch.due_on = args.due_on;
      if (args.status !== undefined) patch.status = args.status;
      if (args.section_id !== undefined) patch.section_id = args.section_id;
      if (args.parent_task_id !== undefined) patch.parent_task_id = args.parent_task_id;
      if (args.is_milestone !== undefined) patch.is_milestone = args.is_milestone;
      if (assigneeId !== undefined) patch.assignee_id = assigneeId;
      if (hasExpectedStamp) patch.expected_updated_at = callerStamp;
      const hasTaskChanges = Object.keys(patch).some((key) => key !== "expected_updated_at");
      const customFields = args.custom_fields ?? [];
      if (!hasTaskChanges && customFields.length === 0) throw badRequest("no fields to update");

      const appliedCustomFields: number[] = [];
      let customValueStamp = callerStamp;
      let taskUpdated = false;
      const writeCustomFields = async () => {
        for (const field of customFields) {
          const saved = await services.setTaskCustomValue(ctx.actor, {
            task_id: taskId,
            field_id: field.field_id,
            value: field.value,
            ...(customValueStamp === undefined ? {} : { expected_updated_at: customValueStamp }),
          });
          appliedCustomFields.push(field.field_id);
          // Chain only when the caller supplied a stamp. Without one the
          // writes stay unconditional, as they were before.
          if (hasExpectedStamp) customValueStamp = saved.updated_at;
        }
      };
      const rethrowWithAppliedFields = (error: unknown): never => {
        if (error instanceof TaskMutationFailure
            && (appliedCustomFields.length > 0 || taskUpdated)) {
          throw new TaskMutationFailure(error.reason, error.message, {
            ...error.metadata,
            applied_custom_fields: [...appliedCustomFields],
            ...(taskUpdated ? { task_updated: true } : {}),
          });
        }
        throw error;
      };

      // A destination project's custom fields can only be written after the
      // task itself belongs to that project. The detail read is only used to
      // choose the write order; the optimistic lock stays the caller's stamp.
      const changesProject = hasTaskChanges && customFields.length > 0 && hasExpectedStamp
        && args.project_id !== undefined
        && (await services.getTaskDetail(ctx.actor, taskId)).project?.id !== args.project_id;

      try {
        if (changesProject) {
          // The task UPDATE locks with the caller's stamp. Its own stamp, not
          // a later re-read, starts the custom-field chain so a concurrent
          // write still conflicts instead of being silently overwritten.
          const updated = await services.updateTaskForActor(ctx.actor, taskId, patch);
          taskUpdated = true;
          customValueStamp = updated.updated_at;
          await writeCustomFields();
        } else if (hasTaskChanges && customFields.length > 0 && hasExpectedStamp) {
          // Compare-and-set chain: custom fields first, each one locking the
          // task row and returning its new stamp, then the task UPDATE last.
          // A concurrent client write therefore conflicts at one of the
          // later steps instead of being silently overwritten. Synchronous
          // automations only run after the final task UPDATE.
          await writeCustomFields();
          patch.expected_updated_at = customValueStamp;
          await services.updateTaskForActor(ctx.actor, taskId, patch);
        } else {
          if (hasTaskChanges) {
            await services.updateTaskForActor(ctx.actor, taskId, patch);
          }
          await writeCustomFields();
        }
      } catch (error) {
        rethrowWithAppliedFields(error);
      }
      const detail = await services.getTaskDetail(ctx.actor, taskId);
      const { output, truncated } = taskDetailPayload(detail);
      return {
        structuredContent: output,
        content: text(
          `Updated task ${taskId}: ${detail.task.name}.`
          + (truncated ? ` Description truncated at ${TASK_DESCRIPTION_LIMIT} characters.` : ""),
        ),
      };
    },
  });
}
