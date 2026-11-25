/**
 * Start work on a development-project issue (docs/dev-projects-phase0.md §6.2).
 *
 * Not built on updateTask: that reads outside its transaction, while start
 * has to decide on values read under the locks below. Lock order is
 * dev_projects (FOR SHARE) → tasks (FOR UPDATE), the same order as a status
 * rename in updateProject (§4.4), so the two serialize:
 * - a rename that commits first is read here as the new name;
 * - a start that commits first wrote the old name, which the rename's bulk
 *   UPDATE (a fresh READ COMMITTED snapshot) then rewrites.
 */
import { audit } from "../audit";
import { runAutomations } from "../automation-runner";
import { withTransaction, type Queryable } from "../db";
import { formatTaskKey } from "../dev-project-keys";
import { emitTaskEvent } from "../domain/events";
import { notifyTask } from "../notify";
import { insertTaskEvent } from "../repositories/tasks";
import { requireTaskAccess, type Actor } from "./actor";
import { recordTaskCompletion, TASK_COMPLETION_COLUMNS, type TaskCompletionRow } from "./task-completion";
import { TaskMutationFailure } from "./task-mutation-failure";
import { taskConflictSnapshot } from "./task-update";

export type StartTaskOptions = {
  /** Reopen a completed issue instead of refusing it. */
  reopen?: boolean;
  /** Fail instead of overwriting a concurrent change, as other task writes do. */
  expectedUpdatedAt?: string;
};

export type StartTaskChanges = { assignee: boolean; status: boolean; reopened: boolean };

export type StartTaskResult = {
  taskId: number;
  key: string;
  branchName: string;
  changed: StartTaskChanges;
};

/** The conflict kinds start_task reports in `conflict` (§6.2). */
export type StartTaskConflict =
  | "task_moved"
  | "not_dev_project"
  | "approval_task"
  | "assigned_to_other"
  | "completed"
  | "recurring_completed";

function startConflict(
  conflict: StartTaskConflict,
  message: string,
  metadata: Record<string, unknown> = {},
): TaskMutationFailure {
  return new TaskMutationFailure("conflict", message, { conflict, ...metadata });
}

/**
 * The status a start moves the task to, or null to leave it. Reopening always
 * moves to start_status so a reopened issue is not left in "Done"; otherwise
 * only a status before start_status, or one not in the options (such as the
 * default inbox), moves forward. The option order stands for progress, so a
 * repeated start never pulls an issue in review back to "in progress".
 */
export function startStatusTarget(input: {
  current: string;
  startStatus: string | null;
  statusOptions: readonly string[];
  statusFieldEnabled: boolean;
  reopening: boolean;
}): string | null {
  const { current, startStatus, statusOptions, statusFieldEnabled, reopening } = input;
  if (startStatus === null || !statusFieldEnabled) return null;
  const startIndex = statusOptions.indexOf(startStatus);
  if (startIndex < 0 || current === startStatus) return null;
  if (reopening) return startStatus;
  const currentIndex = statusOptions.indexOf(current);
  return currentIndex < 0 || currentIndex < startIndex ? startStatus : null;
}

type LockedStart = {
  projectId: number;
  startStatus: string | null;
};

/**
 * Steps 1–4 of the lock procedure: read the primary project unlocked, lock its
 * dev_projects row, lock the task, and confirm the project did not change in
 * between. Returns null when the task moved, so the caller can retry once.
 */
async function lockForStart(q: Queryable, taskId: number): Promise<LockedStart | null> {
  const unlocked = await q.query(
    "SELECT project_id, deleted_at IS NOT NULL AS trashed FROM tasks WHERE id = $1::bigint",
    [taskId],
  );
  const seen = unlocked.rows[0];
  if (!seen || seen.trashed) throw new TaskMutationFailure("missing", "task not found");
  const projectId = seen.project_id === null ? null : Number(seen.project_id);
  const dev = projectId === null
    ? null
    : (await q.query(
        "SELECT start_status FROM dev_projects WHERE project_id = $1::bigint FOR SHARE",
        [projectId],
      )).rows[0];
  const locked = await q.query(
    "SELECT project_id, deleted_at IS NOT NULL AS trashed FROM tasks WHERE id = $1::bigint FOR UPDATE",
    [taskId],
  );
  const row = locked.rows[0];
  if (!row || row.trashed) throw new TaskMutationFailure("missing", "task not found");
  const lockedProjectId = row.project_id === null ? null : Number(row.project_id);
  if (lockedProjectId !== projectId) return null;
  if (projectId === null || !dev) {
    throw startConflict("not_dev_project", "the task's project is not a development project");
  }
  return { projectId, startStatus: dev.start_status == null ? null : String(dev.start_status) };
}

/**
 * Assign the issue to the actor, reopen it when asked, and move its status to
 * the project's start status (§6.2). A repeated call changes nothing and
 * records nothing, so it is safe to retry.
 */
export async function startTask(
  actor: Actor,
  taskId: number,
  options: StartTaskOptions = {},
): Promise<StartTaskResult> {
  if (!Number.isInteger(taskId) || taskId <= 0) throw new TaskMutationFailure("invalid", "invalid task id");
  // Start changes the issue in its development project, so the primary
  // project must grant edit access; a secondary home is not enough.
  await requireTaskAccess(actor, taskId, "edit", { scope: "primary" });

  const outcome = await withTransaction(async (q) => {
    let locked = await lockForStart(q, taskId);
    if (locked === null) locked = await lockForStart(q, taskId);
    if (locked === null) throw startConflict("task_moved", "the task moved to another project while starting it");
    const { projectId, startStatus } = locked;

    const current = (await q.query<TaskCompletionRow & {
      updated_at: string;
      completed_at: string | null;
    }>(
      `SELECT ${TASK_COMPLETION_COLUMNS}, updated_at::text AS updated_at
         FROM tasks WHERE id = $1::bigint`,
      [taskId],
    )).rows[0];
    if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== ""
        && current.updated_at !== options.expectedUpdatedAt) {
      const snapshot = await taskConflictSnapshot(taskId);
      throw new TaskMutationFailure("conflict", "conflict", {
        updated_at: current.updated_at, current: snapshot.current,
      });
    }
    const approval = await q.query("SELECT 1 FROM task_approvals WHERE task_id = $1::bigint", [taskId]);
    if (approval.rowCount) {
      throw startConflict("approval_task", "approval tasks cannot be started; use the approval actions in Atlas");
    }
    if (current.assignee_id !== null && Number(current.assignee_id) !== actor.uid) {
      const assignee = await q.query("SELECT id, name FROM users WHERE id = $1::bigint", [current.assignee_id]);
      throw startConflict("assigned_to_other", "the task is assigned to someone else", {
        assignee: { id: Number(current.assignee_id), name: assignee.rows[0]?.name ?? null },
      });
    }
    let reopening = false;
    if (current.completed) {
      if (options.reopen !== true) {
        throw startConflict("completed", "the task is completed; pass reopen: true to reopen it");
      }
      const spawned = await q.query(
        "SELECT 1 FROM task_recurrence_occurrences WHERE source_task_id = $1::bigint",
        [taskId],
      );
      if (spawned.rowCount) {
        throw startConflict(
          "recurring_completed",
          "the next occurrence of this recurring task already exists; start that one instead",
        );
      }
      reopening = true;
    }
    const project = (await q.query(
      `SELECT COALESCE(status_options, '[]'::jsonb) AS status_options, status_field_enabled
         FROM projects WHERE id = $1::bigint`,
      [projectId],
    )).rows[0];
    const statusOptions = Array.isArray(project?.status_options)
      ? (project.status_options as unknown[]).map(String)
      : [];
    const nextStatus = startStatusTarget({
      current: current.status,
      startStatus,
      statusOptions,
      statusFieldEnabled: project?.status_field_enabled !== false,
      reopening,
    });

    const keyRow = (await q.query(
      `SELECT d.prefix, d.branch_prefix, k.number
         FROM task_keys k JOIN dev_projects d ON d.id = k.namespace_id
        WHERE k.task_id = $1::bigint`,
      [taskId],
    )).rows[0];
    if (!keyRow) throw new Error(`development task ${taskId} has no issue key`);
    const number = Number(keyRow.number);
    const identity = {
      key: formatTaskKey(String(keyRow.prefix), number),
      branchName: `${String(keyRow.branch_prefix)}-${number}`,
    };

    const changed: StartTaskChanges = {
      assignee: current.assignee_id === null,
      status: nextStatus !== null,
      reopened: reopening,
    };
    if (!changed.assignee && !changed.status && !changed.reopened) {
      return { ...identity, changed, projectId };
    }

    const updated = (await q.query<TaskCompletionRow>(
      `UPDATE tasks SET
         assignee_id = $2::bigint,
         status = COALESCE($3::text, status),
         completed = CASE WHEN $4::boolean THEN false ELSE completed END,
         completed_at = CASE WHEN $4::boolean THEN NULL ELSE completed_at END,
         updated_at = now()
       WHERE id = $1::bigint
       RETURNING ${TASK_COMPLETION_COLUMNS}`,
      [taskId, actor.uid, nextStatus, reopening],
    )).rows[0];
    await insertTaskEvent(q, { taskId, actorId: actor.uid, kind: "started", summary: "着手しました" });
    if (reopening) await recordTaskCompletion(q, { task: updated, projectId, actorId: actor.uid });
    if (changed.assignee) {
      await emitTaskEvent({
        projectId, taskId, actorId: actor.uid, type: "task.assigned",
        data: { previous_assignee_id: null, assignee_id: actor.uid },
      }, q);
    }
    if (changed.status) {
      await emitTaskEvent({
        projectId, taskId, actorId: actor.uid, type: "task.status_changed",
        data: { previous_status: current.status, status: nextStatus },
      }, q);
    }
    await audit(actor.uid, "task.update", {
      entity: "task",
      entityId: taskId,
      projectId,
      summary: [
        changed.assignee ? "assignee_id" : null,
        changed.reopened ? "completed" : null,
        changed.status ? "status" : null,
      ].filter(Boolean).join(","),
    }, q);
    return { ...identity, changed, projectId };
  });

  const { changed, projectId, ...identity } = outcome;
  if (changed.assignee || changed.status || changed.reopened) {
    // As in updateTask: status automations run after the commit.
    if (changed.status) await runAutomations(projectId, taskId, "status_changed").catch(() => undefined);
    await notifyTask(taskId);
  }
  return { taskId, ...identity, changed };
}
