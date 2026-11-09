import { db, type Queryable } from "../db";

/** Stable domain-event names consumed by automation and future AI features. */
export const DOMAIN_EVENT_TYPES = [
  "task.created",
  "task.completed",
  "task.reopened",
  "task.assigned",
  "task.status_changed",
  "task.due_changed",
  "task.section_changed",
  "task.custom_field_changed",
  "task.added_to_project",
  "task.deleted",
  "comment.created",
  "comment.updated",
  "form.submitted",
  "project.status_changed",
  "task.due_soon",
  "task.overdue",
  "task.manual_rule",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export type DomainEventInput = {
  workspaceId: number;
  projectId?: number | null;
  actorId?: number | null;
  type: DomainEventType;
  version?: number;
  subjectType: "task" | "project" | "comment" | "form";
  subjectId: number;
  data?: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: number | null;
  chainDepth?: number;
  occurredAt?: Date | string;
};

export type DomainEventRow = {
  id: number;
  workspace_id: number;
  project_id: number | null;
  actor_id: number | null;
  type: DomainEventType;
  version: number;
  subject_type: string;
  subject_id: number;
  data: Record<string, unknown>;
  correlation_id: string | null;
  causation_id: number | null;
  chain_depth: number;
  occurred_at: string;
  attempts: number;
};

const writer = (q?: Queryable) => q ?? db;

/** Persist an event. Callers may pass a transaction client for atomic writes. */
export async function emitDomainEvent(
  input: DomainEventInput,
  q?: Queryable,
): Promise<number> {
  const result = await writer(q).query(
    `INSERT INTO domain_events (
       workspace_id, project_id, actor_id, type, version, subject_type, subject_id,
       data, correlation_id, causation_id, chain_depth, occurred_at
     ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6, $7::bigint,
       $8::jsonb, $9, $10::bigint, $11, COALESCE($12::timestamptz, now()))
     RETURNING id`,
    [
      input.workspaceId,
      input.projectId ?? null,
      input.actorId ?? null,
      input.type,
      input.version ?? 1,
      input.subjectType,
      input.subjectId,
      JSON.stringify(input.data ?? {}),
      input.correlationId ?? null,
      input.causationId ?? null,
      input.chainDepth ?? 0,
      input.occurredAt ?? null,
    ],
  );
  return Number(result.rows[0].id);
}

async function workspaceForProject(projectId: number | null | undefined): Promise<number | null> {
  if (!projectId) return null;
  const r = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [projectId]);
  return r.rows[0]?.workspace_id ? Number(r.rows[0].workspace_id) : null;
}

/** Convenience helper for task mutations when workspace id is not at hand. */
export async function emitTaskEvent(input: {
  projectId: number | null;
  taskId: number;
  actorId: number | null;
  type: DomainEventType;
  data?: Record<string, unknown>;
  causationId?: number | null;
  chainDepth?: number;
  correlationId?: string | null;
}): Promise<void> {
  const workspaceId = await workspaceForProject(input.projectId);
  if (workspaceId === null) return;
  await emitDomainEvent({
    workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    type: input.type,
    subjectType: "task",
    subjectId: input.taskId,
    data: input.data,
    causationId: input.causationId,
    chainDepth: input.chainDepth,
    correlationId: input.correlationId,
  });
}

export function isDomainEventType(value: unknown): value is DomainEventType {
  return typeof value === "string" && (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}
