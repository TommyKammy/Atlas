import type { Queryable } from "@/lib/db";
import { emitTaskEvent } from "@/lib/domain/events";
import { insertNextOccurrence, type RecurringTask } from "./task-write";

export const TASK_COMPLETION_COLUMNS = `id, project_id, section_id, parent_task_id, name, description,
  assignee_id, start_on::text AS start_on, due_on::text AS due_on, status, recurrence,
  is_milestone, completed`;

export type TaskCompletionRow = RecurringTask & {
  id: number;
  parent_task_id: number | null;
  completed: boolean;
};

/** Record the effects of a completion transition in the transaction that changed the task. */
export async function recordTaskCompletion(
  q: Queryable,
  {
    task, projectId, actorId, data, ...eventContext
  }: {
    task: TaskCompletionRow;
    projectId: number | null;
    actorId: number;
    data?: Record<string, unknown>;
    causationId?: number | null;
    automationRuleId?: number | null;
    chainDepth?: number;
    correlationId?: string | null;
  },
): Promise<void> {
  const { id: taskId, completed } = task;
  const kind = completed ? "completed" : "reopened";
  await q.query(
    "INSERT INTO task_events (task_id, actor_id, kind, summary) VALUES ($1, $2, $3, $4)",
    [taskId, actorId, kind, completed ? "タスクを完了しました" : "タスクを未完了に戻しました"],
  );
  await emitTaskEvent({
    ...eventContext,
    projectId,
    taskId,
    actorId,
    type: completed ? "task.completed" : "task.reopened",
    data: { ...data, previous: !completed, next: completed },
  }, q);

  if (!completed || task.parent_task_id !== null || task.recurrence === "none") return;
  const claimed = await q.query(
    `INSERT INTO task_recurrence_occurrences (source_task_id) VALUES ($1)
     ON CONFLICT (source_task_id) DO NOTHING`,
    [taskId],
  );
  if (claimed.rowCount === 0) return;
  const nextTaskId = await insertNextOccurrence(q, task);
  if (nextTaskId === null) throw new Error("failed to create recurring task");
  await q.query(
    "UPDATE task_recurrence_occurrences SET next_task_id = $2 WHERE source_task_id = $1",
    [taskId, nextTaskId],
  );
  await q.query(
    "INSERT INTO task_events (task_id, actor_id, kind, summary) VALUES ($1, $2, 'recurrence_spawned', $3)",
    [taskId, actorId, "次回のタスクを生成しました"],
  );
  await emitTaskEvent({
    ...eventContext,
    projectId: task.project_id,
    taskId: nextTaskId,
    actorId,
    type: "task.created",
    data: { recurrence: true, from_task_id: taskId },
  }, q);
}
