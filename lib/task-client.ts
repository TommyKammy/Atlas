import { ApiError, api } from "./api-client";

export type TaskConflictPayload = {
  updated_at?: string;
  current?: unknown;
};

export class TaskConflictError extends ApiError {
  updatedAt: string | null;
  current: unknown;

  constructor(error: ApiError) {
    super(409, error.message, error.body);
    this.name = "TaskConflictError";
    const body = (error.body ?? null) as TaskConflictPayload | null;
    this.updatedAt = typeof body?.updated_at === "string" ? body.updated_at : null;
    this.current = body?.current ?? null;
  }
}

/** PATCH a task with optimistic-lock metadata and a typed 409 error. */
export async function patchTask(
  taskId: number,
  fields: Record<string, unknown>,
  expectedUpdatedAt?: string | null,
): Promise<{ id: number }> {
  try {
    return await api<{ id: number }>(`/api/tasks/${taskId}`, "PATCH", {
      ...fields,
      ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw new TaskConflictError(error);
    throw error;
  }
}

export type TaskCustomValueResult = {
  cleared?: boolean;
  updated_at?: string;
};

/** Write one custom-field value with the same optimistic-lock contract as patchTask. */
export async function saveTaskCustomValue(
  taskId: number,
  fieldId: number,
  value: unknown,
  expectedUpdatedAt?: string | null,
): Promise<TaskCustomValueResult> {
  try {
    return await api<TaskCustomValueResult>("/api/task-values", "POST", {
      task_id: taskId,
      field_id: fieldId,
      value,
      ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw new TaskConflictError(error);
    throw error;
  }
}
