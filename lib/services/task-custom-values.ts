import { badRequest, forbidden, notFound } from "../api/errors";
import { withTransaction, type Queryable } from "../db";
import { emitTaskEvent } from "../domain/events";
import { canEditFieldValue } from "../field-access";
import { notifyField, notifyTask } from "../notify";
import { isEmptyTaskCustomValue, normalizeTaskCustomValue } from "../task-custom-value";
import { requireTaskAccess, type Actor } from "./actor";

type TaskCustomValueWrite = {
  actor: Actor;
  taskId: number;
  projectId: number | null;
  fieldId: unknown;
  value: unknown;
};

/**
 * Transaction body for one task custom-field value.
 * Exported so tests can drive the SQL-dependent branches with a Queryable.
 */
export async function writeTaskCustomValue(
  q: Queryable,
  { actor, taskId, projectId, fieldId, value }: TaskCustomValueWrite,
): Promise<{ cleared: boolean }> {
  const task = await q.query(
    "SELECT id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE",
    [taskId],
  );
  if (task.rowCount === 0) throw notFound("task not found");
  const f = await q.query(
    `SELECT name, field_type, project_id, config, access_level, editor_ids FROM custom_fields
     WHERE id = $1::bigint AND deleted_at IS NULL FOR SHARE`,
    [fieldId],
  );
  if (f.rowCount === 0 || Number(f.rows[0].project_id) !== projectId) {
    throw notFound("field not found");
  }
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
  await emitTaskEvent({
    projectId, taskId, actorId: actor.uid, type: "task.custom_field_changed",
    data: { field_id: fieldId, field_name: f.rows[0].name, value: cleared ? null : value, ...(cleared ? { cleared: true } : {}) },
  }, q);
  return { cleared };
}

/**
 * Upsert one task's custom-field value for an actor that need not come from an
 * HTTP session. Validation order and errors mirror POST /api/task-values.
 */
export async function setTaskCustomValue(
  actor: Actor,
  input: { task_id: unknown; field_id?: unknown; value?: unknown },
): Promise<{ cleared: boolean }> {
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
  }));
  await Promise.all([notifyTask(taskId), notifyField(field_id as number)]);
  return result;
}
