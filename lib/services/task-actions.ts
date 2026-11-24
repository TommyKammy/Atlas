import { badRequest, ApiError } from "../api/errors";
import { requireProjectAccess, requireTaskAccess, type Actor } from "./actor";
import { TaskMutationFailure } from "./task-mutation-failure";
import { deleteTask, updateTask } from "./task-update";

/**
 * Update a task for an actor that need not come from an HTTP session.
 * Mirrors PATCH /api/tasks/[id]: the task grants the edit permission, and every
 * other project touched by the patch must grant edit access as well.
 */
export async function updateTaskForActor(
  actor: Actor,
  taskId: number,
  input: Record<string, unknown>,
): Promise<{ id: number; updated_at: string }> {
  if (!Number.isInteger(taskId) || taskId <= 0) throw badRequest("invalid task_id");
  const auth = await requireTaskAccess(actor, taskId, "edit");
  return updateTask(input, {
    taskId,
    uid: actor.uid,
    projectId: auth.projectId,
    authorizeProject: async (projectId) => {
      try {
        await requireProjectAccess(actor, projectId, "edit");
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        throw new TaskMutationFailure(error.status === 404 ? "missing" : "denied", error.message);
      }
    },
  });
}

/**
 * Move a task to the trash for an actor that need not come from an HTTP session.
 * The primary project governs deletion, matching DELETE /api/tasks/[id].
 * Permanent deletion is intentionally not exposed.
 */
export async function trashTaskForActor(actor: Actor, taskId: number): Promise<{ deleted: number }> {
  if (!Number.isInteger(taskId) || taskId <= 0) throw badRequest("invalid task_id");
  const auth = await requireTaskAccess(actor, taskId, "edit", { scope: "primary" });
  return deleteTask({ force: false }, { taskId, uid: actor.uid, projectId: auth.projectId });
}
