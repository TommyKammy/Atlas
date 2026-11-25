import { z } from "zod";
import { badRequest } from "@/lib/api/errors";
import type { TaskDetailView } from "@/lib/services/queries";
import { TaskMutationFailure } from "@/lib/services/task-mutation-failure";
import { TASK_DESCRIPTION_LIMIT, taskDetailPayload, taskLabel } from "./task-detail";
import {
  defineTool, idSchema, PROJECT_REF_NOTE, projectRefSchema, TASK_REF_NOTE, taskRefSchema, text,
  UNTRUSTED_DATA_NOTE, type McpToolContext, type McpToolDefinition, type McpToolResult,
} from "./tool-definition";
import {
  beginWrite, expectedUpdatedAtSchema, failedUpdate, idempotencyKeySchema, nullableDateSchema,
  writeResultAnnotations, type FailedUpdate, type McpWriteServices,
} from "./write-tool";

const nullableIdSchema = z.union([idSchema, z.null()]).optional();
const nullableTaskRefSchema = z.union([taskRefSchema, z.null()]).optional();

/**
 * The reason reported for a requested value that a recovered creation cannot
 * confirm: it was either never applied or changed by someone since.
 */
export const NOT_CONFIRMED = "not_confirmed";

type CustomFieldInput = { field_id: number; value: unknown };

/** What a creation asked for, with references already resolved to ids. */
type RequestedCreation = {
  fields: Record<string, unknown>;
  customFields: CustomFieldInput[];
};

function resolveAssigneeId(
  assignee: "me" | number | null | undefined,
  uid: number,
): number | null | undefined {
  if (assignee === undefined) return undefined;
  return assignee === "me" ? uid : assignee;
}

function sameValue(current: unknown, requested: unknown): boolean {
  if (typeof requested === "number") return current != null && Number(current) === requested;
  return (current ?? null) === (requested ?? null);
}

/** Requested task fields compared against the detail, by MCP argument name. */
function currentValue(detail: TaskDetailView, field: string): unknown {
  switch (field) {
    case "assignee": return detail.task.assignee_id;
    default: return (detail.task as Record<string, unknown>)[field];
  }
}

/** The result for a created task whose follow-up writes or read did not all succeed. */
function partialCreation(
  taskId: number,
  detail: TaskDetailView | null,
  failedUpdates: FailedUpdate[],
  message: string,
  extra: Record<string, unknown> = {},
): McpToolResult {
  return {
    structuredContent: {
      created: true,
      id: taskId,
      ...extra,
      task: detail ? taskDetailPayload(detail).output.task : { id: taskId },
      failed_updates: failedUpdates,
    },
    content: text(message),
    isError: true,
  };
}

/**
 * Answer a retry whose first execution created the task but never recorded a
 * response (docs/dev-projects-phase0.md §7). Only reads: re-applying the
 * follow-up writes could overwrite edits made since, so every requested value
 * that the task does not hold now is reported as not confirmed instead.
 */
async function recoverCreation(
  services: McpWriteServices,
  ctx: McpToolContext,
  taskId: number,
  requested: RequestedCreation,
): Promise<McpToolResult> {
  const recovered = { recovered: true };
  let detail: TaskDetailView;
  try {
    detail = await services.getTaskDetail(ctx.actor, taskId);
  } catch (error) {
    return partialCreation(
      taskId, null, [failedUpdate("save_task", "task_detail", error)],
      `Task ${taskId} was created by an earlier request with this idempotency_key, `
      + "but it could not be read now.",
      recovered,
    );
  }
  const unconfirmed: FailedUpdate[] = [];
  for (const [field, value] of Object.entries(requested.fields)) {
    if (!sameValue(currentValue(detail, field), value)) {
      unconfirmed.push({ field, error: NOT_CONFIRMED });
    }
  }
  for (const field of requested.customFields) {
    const matches = await services.taskCustomValueMatches(ctx.actor, taskId, field.field_id, field.value)
      .catch(() => false);
    if (!matches) unconfirmed.push({ field: `custom_fields.${field.field_id}`, error: NOT_CONFIRMED });
  }
  const label = taskLabel(detail.task);
  if (unconfirmed.length > 0) {
    return partialCreation(
      taskId, detail, unconfirmed,
      `Task ${label} was created by an earlier request with this idempotency_key. Some requested `
      + "values are not on the task now: they were not applied or were changed since. Check "
      + `them with get_task and update with save_task using id ${taskId} if needed.`,
      recovered,
    );
  }
  const { output, truncated } = taskDetailPayload(detail);
  return {
    structuredContent: { ...output, ...recovered },
    content: text(
      `Task ${label} was created by an earlier request with this idempotency_key: ${detail.task.name}.`
      + (truncated ? ` Description truncated at ${TASK_DESCRIPTION_LIMIT} characters.` : ""),
    ),
  };
}

export function createSaveTaskTool(services: McpWriteServices): McpToolDefinition {
  const saveTaskSchema = z.object({
    id: taskRefSchema.optional(),
    project_id: projectRefSchema.optional(),
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(50_000).optional(),
    assignee: z.union([z.literal("me"), idSchema, z.null()]).optional(),
    start_on: nullableDateSchema,
    due_on: nullableDateSchema,
    status: z.string().min(1).max(64).optional(),
    section_id: nullableIdSchema,
    parent_task_id: nullableTaskRefSchema,
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
      + "task detail. A retry with the same idempotency_key after an interrupted creation returns "
      + "the task already created, with recovered: true; requested values the task does not "
      + "hold now are listed in failed_updates as not_confirmed and are not applied again. "
      + "id and parent_task_id accept issue keys and project_id accepts a development-project "
      + "prefix. " + TASK_REF_NOTE + " " + PROJECT_REF_NOTE + " "
      + UNTRUSTED_DATA_NOTE,
    requiredScope: "write",
    annotations: writeResultAnnotations,
    inputSchema: saveTaskSchema,
    handler: async (args, ctx) => {
      const tokenId = await beginWrite(services, ctx);
      const assigneeId = resolveAssigneeId(args.assignee, ctx.actor.uid);
      // References resolve before anything else, so keys and prefixes behave
      // exactly like the ids they name, including in the idempotency hash.
      const projectId = args.project_id === undefined
        ? undefined
        : await services.resolveProjectRef(ctx.actor, args.project_id);
      const parentTaskId = args.parent_task_id === undefined || args.parent_task_id === null
        ? args.parent_task_id
        : await services.resolveTaskRef(ctx.actor, args.parent_task_id, "view");

      if (args.id === undefined) {
        if (args.name === undefined || args.name.trim() === "") throw badRequest("name is required");
        if (projectId === undefined) throw badRequest("project_id is required");
        const createInput: Record<string, unknown> = {
          project_id: projectId,
          name: args.name,
        };
        if (args.section_id !== undefined) createInput.section_id = args.section_id;
        if (parentTaskId !== undefined) createInput.parent_task_id = parentTaskId;
        if (args.start_on !== undefined) createInput.start_on = args.start_on;
        if (args.due_on !== undefined) createInput.due_on = args.due_on;
        if (assigneeId !== undefined) createInput.assignee_id = assigneeId;
        if (args.is_milestone !== undefined) createInput.is_milestone = args.is_milestone;

        const requested: RequestedCreation = {
          fields: {
            project_id: projectId,
            name: args.name.trim(),
            ...(args.section_id !== undefined ? { section_id: args.section_id } : {}),
            ...(parentTaskId !== undefined ? { parent_task_id: parentTaskId } : {}),
            ...(args.start_on !== undefined ? { start_on: args.start_on } : {}),
            ...(args.due_on !== undefined ? { due_on: args.due_on } : {}),
            ...(assigneeId !== undefined ? { assignee: assigneeId } : {}),
            ...(args.is_milestone !== undefined ? { is_milestone: args.is_milestone } : {}),
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
          },
          customFields: args.custom_fields ?? [],
        };

        return services.withIdempotency(
          {
            tokenId,
            toolName: "save_task",
            key: args.idempotency_key,
            args: { ...args, project_id: projectId, parent_task_id: parentTaskId },
          },
          async (reservation) => {
            const created = await services.createTask(ctx.actor, createInput, {
              onInserted: (q, taskId) => reservation.recordCreatedTask(q, taskId),
            });
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
              return partialCreation(
                created.id, detail, failedUpdates,
                `Created task ${detail ? taskLabel(detail.task) : created.id}, but some fields could `
                + `not be applied. Retry them with save_task using id ${created.id}.`,
              );
            }
            const { output, truncated } = taskDetailPayload(detail);
            return {
              structuredContent: output,
              content: text(
                `Created task ${taskLabel(detail.task)}: ${detail.task.name}.`
                + (truncated ? ` Description truncated at ${TASK_DESCRIPTION_LIMIT} characters.` : ""),
              ),
            };
          },
          { recover: ({ createdTaskId }) => recoverCreation(services, ctx, createdTaskId, requested) },
        );
      }

      const taskId = await services.resolveTaskRef(ctx.actor, args.id, "view");
      const callerStamp = args.expected_updated_at;
      const hasExpectedStamp = callerStamp !== undefined;
      const patch: Record<string, unknown> = {};
      if (projectId !== undefined) patch.project_id = projectId;
      if (args.name !== undefined) patch.name = args.name;
      if (args.description !== undefined) patch.description = args.description;
      if (args.start_on !== undefined) patch.start_on = args.start_on;
      if (args.due_on !== undefined) patch.due_on = args.due_on;
      if (args.status !== undefined) patch.status = args.status;
      if (args.section_id !== undefined) patch.section_id = args.section_id;
      if (parentTaskId !== undefined) patch.parent_task_id = parentTaskId;
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
        && projectId !== undefined
        && (await services.getTaskDetail(ctx.actor, taskId)).project?.id !== projectId;

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
          `Updated task ${taskLabel(detail.task)}: ${detail.task.name}.`
          + (truncated ? ` Description truncated at ${TASK_DESCRIPTION_LIMIT} characters.` : ""),
        ),
      };
    },
  });
}
