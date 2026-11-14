import { audit } from "../audit";
import { hasTaskSubject } from "../automation/task-target";
import { db, type Queryable } from "../db";
import type { DomainEventRow } from "../domain/events";
import { emitTaskEvent } from "../domain/events";
import { canEditProject } from "../project-roles";
import { getProjectAccess } from "../repositories/projects";
import { logEvent } from "../repositories/tasks";

export type CapabilitySource = "automation" | "ai" | "manual";

export type CapabilityContext = {
  actorId: number;
  source: CapabilitySource;
  projectId: number;
  correlationId?: string | null;
  /** Parent event; actions emit child events with this causation id. */
  eventId?: number | null;
  chainDepth: number;
  ruleId?: number | null;
  event?: DomainEventRow | null;
  q?: Queryable;
  notifyAfterCommit?: (projectId: number) => void;
  webhookDelivery?: { id: string; sentAt: string };
};

export type CapabilityResult = {
  summary: string;
  data?: Record<string, unknown>;
};

export function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function actionTaskId(params: Record<string, unknown>, event: DomainEventRow | null | undefined): number | null {
  if (event?.subject_type === "task" && !hasTaskSubject(event.type)) return null;
  const id = event?.subject_type === "task" ? event.subject_id : params.task_id;
  // Planned actions may predate the validator. A rendered string is not a fixed target.
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function taskProject(taskId: number, q: Queryable): Promise<number> {
  const r = await q.query(
    "SELECT project_id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
    [taskId],
  );
  const projectId = r.rows[0]?.project_id;
  if (!projectId) throw new Error("task not found or has no project");
  return Number(projectId);
}

export async function assertEdit(ctx: CapabilityContext, projectId: number): Promise<void> {
  const access = await getProjectAccess(ctx.actorId, projectId, ctx.q);
  if (!canEditProject(access.role)) {
    throw new Error("rule owner does not have edit access to the project");
  }
}

export async function finishTaskAction(
  ctx: CapabilityContext,
  taskId: number,
  eventType:
    | "task.completed"
    | "task.assigned"
    | "task.status_changed"
    | "task.due_changed"
    | "task.section_changed"
    | "task.custom_field_changed",
  data: Record<string, unknown>,
  summary: string,
  scopeProjectId?: number,
): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const projectId = scopeProjectId ?? await taskProject(taskId, q);
  await logEvent(taskId, ctx.actorId, eventType.replace("task.", ""), summary, q);
  await audit(ctx.actorId, `automation.${eventType}`, {
    entity: "task",
    entityId: taskId,
    projectId,
    summary: `[${ctx.source}] ${summary}`,
  }, q);
  await emitTaskEvent({
    projectId,
    taskId,
    actorId: ctx.actorId,
    type: eventType,
    data,
    causationId: ctx.eventId ?? null,
    automationRuleId: ctx.ruleId ?? null,
    chainDepth: ctx.chainDepth + 1,
    correlationId: ctx.correlationId ?? null,
  }, q);
  ctx.notifyAfterCommit?.(projectId);
  return { summary, data };
}
