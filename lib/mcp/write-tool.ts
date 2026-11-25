import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { addComment } from "@/lib/services/comments";
import {
  createProject,
  createProjectFromTemplate,
  updateProject,
} from "@/lib/services/projects";
import * as queries from "@/lib/services/queries";
import { createSection } from "@/lib/services/sections";
import { trashTaskForActor, updateTaskForActor } from "@/lib/services/task-actions";
import { createTask } from "@/lib/services/task-create";
import { setTaskCustomValue, taskCustomValueMatches } from "@/lib/services/task-custom-values";
import { resolveProjectRef, resolveTaskRef } from "@/lib/services/task-keys";
import { TaskMutationFailure } from "@/lib/services/task-mutation-failure";
import { MCP_IDEMPOTENCY_KEY_MAX_LENGTH, withIdempotency } from "./idempotency";
import { enforceMcpWriteLimit } from "./rate-limit";
import { dateSchema, type McpToolContext } from "./tool-definition";

export function writeAnnotations(options: { destructive?: boolean; idempotent?: boolean } = {}): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: options.destructive === true,
    idempotentHint: options.idempotent === true,
    openWorldHint: false,
  };
}

/** Write dates must also be real calendar days, so creation cannot reach the DB with one. */
const writeDateSchema = dateSchema.refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "invalid date");
export const nullableDateSchema = z.union([writeDateSchema, z.null()]).optional();
export const idempotencyKeySchema = z.string().min(1).max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH).optional();
export const expectedUpdatedAtSchema = z.string().min(1).max(100).optional();
export const writeResultAnnotations = writeAnnotations();

/** Write services and policy hooks are injected so unit tests never need a database. */
export type McpWriteServices = {
  createTask: typeof createTask;
  updateTaskForActor: typeof updateTaskForActor;
  trashTaskForActor: typeof trashTaskForActor;
  setTaskCustomValue: typeof setTaskCustomValue;
  addComment: typeof addComment;
  createSection: typeof createSection;
  createProject: typeof createProject;
  createProjectFromTemplate: typeof createProjectFromTemplate;
  updateProject: typeof updateProject;
  getTaskDetail: typeof queries.getTaskDetail;
  getProjectSummary: typeof queries.getProjectSummary;
  loadWorkspaceId: typeof queries.loadWorkspaceId;
  withIdempotency: typeof withIdempotency;
  enforceWriteLimit: typeof enforceMcpWriteLimit;
  resolveTaskRef: typeof resolveTaskRef;
  resolveProjectRef: typeof resolveProjectRef;
  taskCustomValueMatches: typeof taskCustomValueMatches;
};

export const DEFAULT_MCP_WRITE_SERVICES: McpWriteServices = {
  createTask,
  updateTaskForActor,
  trashTaskForActor,
  setTaskCustomValue,
  addComment,
  createSection,
  createProject,
  createProjectFromTemplate,
  updateProject,
  getTaskDetail: queries.getTaskDetail,
  getProjectSummary: queries.getProjectSummary,
  loadWorkspaceId: queries.loadWorkspaceId,
  withIdempotency,
  enforceWriteLimit: enforceMcpWriteLimit,
  resolveTaskRef,
  resolveProjectRef,
  taskCustomValueMatches,
};

/**
 * Consume the per-token write budget and return the token id used by
 * idempotency. Every write tool starts with this call.
 */
export async function beginWrite(services: McpWriteServices, ctx: McpToolContext): Promise<number> {
  const tokenId = ctx.actor.tokenId;
  if (tokenId === undefined) {
    throw new ApiError(400, "invalid MCP token id", "bad_request");
  }
  await services.enforceWriteLimit(tokenId);
  return tokenId;
}

export type FailedUpdate = { field: string; error: string };

/**
 * A creation already committed, so follow-up failures must become data in the
 * idempotency response instead of exceptions that delete the reservation.
 */
export function failedUpdate(toolName: string, field: string, error: unknown): FailedUpdate {
  if (error instanceof ApiError || error instanceof TaskMutationFailure) {
    return { field, error: error.message };
  }
  console.error(`[mcp] ${toolName} follow-up ${field} failed:`, error);
  return { field, error: "internal error" };
}
