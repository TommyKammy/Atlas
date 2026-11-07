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

export function toggleTaskCompletion(
  taskId: number,
  completed: boolean,
  expectedUpdatedAt?: string | null,
  extra?: Record<string, unknown>,
) {
  return patchTask(taskId, { completed, ...extra }, expectedUpdatedAt);
}
