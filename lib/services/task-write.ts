import type { Queryable } from "../db";
import { nextOccurrence } from "../recurrence";

const RECURRENCES = new Set(["none", "daily", "weekly", "monthly"]);

export type TaskPatchCurrent = {
  start_on: string | null;
  due_on: string | null;
};

export type TaskPatchValidation =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string };

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateOrNull(value: unknown, field: string): string | null | { error: string } {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !isDate(value)) {
    return { error: `invalid ${field}` };
  }
  return value;
}

function integerOrError(value: unknown, field: string, min: number, max: number): number | { error: string } {
  if (value === null || value === undefined || value === "") {
    return { error: `${field} must be an integer between ${min} and ${max}` };
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${field} must be an integer between ${min} and ${max}` };
  }
  return n;
}

/**
 * Validate and normalize the patchable columns of a task write.
 * Authorization and cross-project target checks stay in the route because
 * they need request context; this function is pure and unit-testable.
 */
export function validateTaskPatch(
  input: Record<string, unknown>,
  current: TaskPatchCurrent,
): TaskPatchValidation {
  const values: Record<string, unknown> = {};

  if ("name" in input) {
    if (typeof input.name !== "string" || input.name.trim() === "") {
      return { ok: false, error: "name is required" };
    }
    values.name = input.name.trim();
  }

  if ("description" in input) {
    if (input.description !== null && typeof input.description !== "string") {
      return { ok: false, error: "invalid description" };
    }
    values.description = input.description ?? "";
  }

  if ("completed" in input) {
    if (typeof input.completed !== "boolean") {
      return { ok: false, error: "completed must be a boolean" };
    }
    values.completed = input.completed;
  }

  if ("progress" in input) {
    const progress = integerOrError(input.progress, "progress", 0, 100);
    if (typeof progress !== "number") return { ok: false, error: progress.error };
    values.progress = progress;
  }

  if ("position" in input) {
    const position = integerOrError(input.position, "position", 0, Number.MAX_SAFE_INTEGER);
    if (typeof position !== "number") return { ok: false, error: position.error };
    values.position = position;
  }

  if ("status" in input) {
    if (typeof input.status !== "string" || input.status.trim() === "") {
      return { ok: false, error: "status must not be empty" };
    }
    values.status = input.status.trim();
  }

  if ("recurrence" in input) {
    const recurrence = input.recurrence === "" ? "none" : input.recurrence;
    if (typeof recurrence !== "string" || !RECURRENCES.has(recurrence)) {
      return { ok: false, error: "invalid recurrence" };
    }
    values.recurrence = recurrence;
  }

  let start = current.start_on;
  let due = current.due_on;
  if ("start_on" in input) {
    const parsed = dateOrNull(input.start_on, "start_on");
    if (typeof parsed === "object" && parsed !== null) return { ok: false, error: parsed.error };
    start = parsed;
    values.start_on = parsed;
  }
  if ("due_on" in input) {
    const parsed = dateOrNull(input.due_on, "due_on");
    if (typeof parsed === "object" && parsed !== null) return { ok: false, error: parsed.error };
    due = parsed;
    values.due_on = parsed;
  }
  if (start !== null && due !== null && start > due) {
    return { ok: false, error: "start_on must be on or before due_on" };
  }

  return { ok: true, values };
}

export type RecurringTask = {
  project_id: number | null;
  section_id: number | null;
  name: string;
  description: string;
  assignee_id: number | null;
  start_on: string | null;
  due_on: string | null;
  status: string;
  recurrence: string;
};

/** Create the next occurrence for a completed recurring task inside the caller's transaction. */
export async function insertNextOccurrence(
  q: Queryable,
  task: RecurringTask,
): Promise<number | null> {
  if (task.recurrence === "none") return null;
  const r = await q.query(
    `INSERT INTO tasks (project_id, section_id, parent_task_id, name, description, assignee_id,
       start_on, due_on, progress, status, recurrence, position)
     VALUES ($1, $2, NULL, $3, $4, $5, $6::date, $7::date, 0, $8, $9,
       COALESCE((SELECT MAX(position) FROM tasks WHERE COALESCE(project_id,-1) = COALESCE($1::bigint,-1) AND COALESCE(section_id,-1) = COALESCE($2::bigint,-1) AND parent_task_id IS NULL), 0) + 1000)
     RETURNING id`,
    [
      task.project_id,
      task.section_id,
      task.name,
      task.description,
      task.assignee_id,
      nextOccurrence(task.start_on, task.recurrence),
      nextOccurrence(task.due_on, task.recurrence),
      task.status,
      task.recurrence,
    ],
  );
  return r.rows[0]?.id ?? null;
}
