import { audit, auditScope } from "../audit";
import { badRequest, forbidden, notFound } from "../api/errors";
import { withTransaction, type Queryable } from "../db";
import { emitTaskEvent } from "../domain/events";
import { canEditFieldValue } from "../field-access";
import { notifyField, notifyTask } from "../notify";
import { logEvent } from "../repositories/tasks";
import { isEmptyTaskCustomValue, normalizeTaskCustomValue } from "../task-custom-value";
import { requireTaskAccess, type Actor } from "./actor";
import { TaskMutationFailure } from "./task-mutation-failure";

type TaskCustomValueWrite = {
  actor: Actor;
  taskId: number;
  projectId: number | null;
  fieldId: unknown;
  value: unknown;
  /** Same compare-and-set contract as updateTask's expected_updated_at. */
  expectedUpdatedAt?: string | null;
};

/**
 * Transaction body for one task custom-field value.
 * Exported so tests can drive the SQL-dependent branches with a Queryable.
 *
 * The task row is locked before the stamp comparison so a concurrent write
 * cannot slip between the check and the value write. A successful write bumps
 * tasks.updated_at, which makes the value change visible to compare-and-set
 * callers (task name edits, later custom-field writes, MCP retries).
 */
export async function writeTaskCustomValue(
  q: Queryable,
  { actor, taskId, projectId, fieldId, value, expectedUpdatedAt }: TaskCustomValueWrite,
): Promise<{ cleared: boolean; updated_at: string }> {
  const task = await q.query(
    "SELECT id, updated_at::text AS updated_at FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
    [taskId],
  );
  if (task.rowCount === 0) throw notFound("task not found");
  const taskUpdatedAt = (task.rows[0] as { updated_at: string }).updated_at;
  if (typeof expectedUpdatedAt === "string" && expectedUpdatedAt !== ""
      && taskUpdatedAt !== expectedUpdatedAt) {
    throw new TaskMutationFailure("conflict", "conflict", {
      current_updated_at: taskUpdatedAt,
    });
  }
  const f = await q.query(
    `SELECT name, field_type, project_id, config, access_level, editor_ids FROM custom_fields
     WHERE id = $1::bigint AND deleted_at IS NULL FOR SHARE`,
    [fieldId],
  );
  if (f.rowCount === 0 || Number(f.rows[0].project_id) !== projectId) {
    throw notFound("field not found");
  }
  const fieldName = String(f.rows[0].name);
  if (!(await canEditFieldValue(actor.uid, projectId, f.rows[0], q))) {
    throw forbidden("field access denied");
  }
  const normalized = await normalizeTaskCustomValue(f.rows[0], value, actor.uid, q);
  if (!normalized.ok) {
    throw normalized.status === 403 ? forbidden(normalized.error) : badRequest(normalized.error);
  }
  const { value_text: text, value_number: num, value_date: date, value_json: json } = normalized.value;
  const cleared = isEmptyTaskCustomValue(normalized.value);
  if (cleared) {
    await q.query(
      "DELETE FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint",
      [taskId, fieldId],
    );
  } else {
    await q.query(
      `INSERT INTO task_custom_values
         (task_id, field_id, value_text, value_number, value_date, value_json)
       VALUES ($1::bigint, $2::bigint, $3, $4, $5::date, $6::jsonb)
       ON CONFLICT (task_id, field_id) DO UPDATE SET
         value_text = EXCLUDED.value_text,
         value_number = EXCLUDED.value_number,
         value_date = EXCLUDED.value_date,
         value_json = EXCLUDED.value_json`,
      [taskId, fieldId, text, num, date, json === null ? null : JSON.stringify(json)],
    );
  }
  const updated = await q.query(
    "UPDATE tasks SET updated_at = now() WHERE id = $1::bigint RETURNING updated_at::text AS updated_at",
    [taskId],
  );
  // A custom-field write is a task change, so it belongs in both the task
  // history and the workspace audit trail. Passing q keeps both rows in the
  // same transaction as the value and the stamp; the helpers add the ambient
  // web/MCP attribution (via, token, client name).
  await logEvent(
    taskId,
    actor.uid,
    "custom_field_changed",
    cleared
      ? `カスタムフィールド「${fieldName}」をクリアしました`
      : `カスタムフィールド「${fieldName}」を変更しました`,
    q,
  );
  await audit(actor.uid, "task.custom_field_update", {
    entity: "task",
    entityId: taskId,
    ...(projectId === null ? await auditScope(projectId, q) : { projectId }),
    summary: fieldName,
  }, q);
  await emitTaskEvent({
    projectId, taskId, actorId: actor.uid, type: "task.custom_field_changed",
    data: { field_id: fieldId, field_name: fieldName, value: cleared ? null : value, ...(cleared ? { cleared: true } : {}) },
  }, q);
  return {
    cleared,
    updated_at: (updated.rows[0] as { updated_at: string }).updated_at,
  };
}

/**
 * Upsert one task's custom-field value for an actor that need not come from an
 * HTTP session. Validation order and errors mirror POST /api/task-values.
 */
export async function setTaskCustomValue(
  actor: Actor,
  input: {
    task_id: unknown;
    field_id?: unknown;
    value?: unknown;
    expected_updated_at?: unknown;
  },
): Promise<{ cleared: boolean; updated_at: string }> {
  const taskId = Number(input.task_id);
  if (!Number.isInteger(taskId) || taskId <= 0) throw badRequest("invalid task_id");
  const auth = await requireTaskAccess(actor, taskId, "edit");
  const { field_id, value } = input;
  if (!field_id) throw badRequest("task_id and field_id are required");
  const result = await withTransaction(q => writeTaskCustomValue(q, {
    actor,
    taskId,
    projectId: auth.projectId,
    fieldId: field_id,
    value,
    expectedUpdatedAt: typeof input.expected_updated_at === "string"
      ? input.expected_updated_at
      : undefined,
  }));
  await Promise.all([notifyTask(taskId), notifyField(field_id as number)]);
  return result;
}
