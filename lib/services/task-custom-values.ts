import { audit, auditScope } from "../audit";
import { badRequest, forbidden, notFound } from "../api/errors";
import { normalizeCustomFieldConfig } from "../custom-fields";
import { db, withTransaction, type Queryable } from "../db";
import { emitTaskEvent } from "../domain/events";
import { canEditFieldValue } from "../field-access";
import { notifyField, notifyTask } from "../notify";
import { logEvent } from "../repositories/tasks";
import { equalTaskCustomValue, isEmptyTaskCustomValue, normalizeTaskCustomValue } from "../task-custom-value";
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

export type TaskCustomFieldConflictState = {
  updated_at: string | null;
  current: Record<string, unknown> | null;
  custom_field?: {
    field_id: number;
    name: string;
    field_type: string;
    config: ReturnType<typeof normalizeCustomFieldConfig>;
    value: {
      value_text: string | null;
      value_number: number | null;
      value_date: string | null;
      value_json: unknown;
    };
  };
};

/**
 * Task fields and stamp plus the conflicting field's metadata and value for a
 * custom-field 409. Everything is read in one statement because separate reads
 * can pair an old value with a newer updated_at: the editor would then see the
 * old value, and "overwrite with the latest" would send the newer stamp and
 * hide the write that happened between the two reads. The field is scoped to
 * the project that authorized the task edit so another project's field cannot
 * be disclosed. A missing field (deleted, other project, invalid id) leaves
 * custom_field out while still returning the task snapshot.
 */
export async function taskCustomFieldConflictState(
  taskId: number,
  projectId: number | null,
  fieldId: unknown,
): Promise<TaskCustomFieldConflictState> {
  const id = Number(fieldId);
  const scopedFieldId = Number.isInteger(id) && id > 0 && projectId !== null ? id : null;
  const result = await db.query(
    `SELECT t.name, t.completed, t.assignee_id, u.name AS assignee_name,
       t.start_on::text AS start_on, t.due_on::text AS due_on,
       t.progress, t.status, t.description, t.section_id, t.is_milestone,
       t.updated_at::text AS updated_at,
       f.id AS field_id, f.name AS field_name, f.field_type, f.config,
       v.value_text, v.value_number, v.value_date::text AS value_date, v.value_json
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN custom_fields f
       ON f.id = $2::bigint AND f.project_id = $3::bigint
      AND f.deleted_at IS NULL
     LEFT JOIN task_custom_values v
       ON v.field_id = f.id AND v.task_id = t.id
     WHERE t.id = $1::bigint`,
    [taskId, scopedFieldId, projectId],
  );
  const row = result.rows[0];
  if (!row) return { updated_at: null, current: null };
  const current = {
    name: row.name,
    completed: row.completed,
    assignee_id: row.assignee_id,
    assignee_name: row.assignee_name,
    start_on: row.start_on,
    due_on: row.due_on,
    progress: row.progress,
    status: row.status,
    description: row.description,
    section_id: row.section_id,
    is_milestone: row.is_milestone,
    updated_at: row.updated_at,
  };
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
  if (row.field_id === null || row.field_id === undefined) {
    return { updated_at: updatedAt, current };
  }
  const valueNumber = row.value_number === null || row.value_number === undefined
    ? null
    : Number(row.value_number);
  return {
    updated_at: updatedAt,
    current,
    custom_field: {
      field_id: Number(row.field_id),
      name: String(row.field_name),
      field_type: String(row.field_type),
      config: normalizeCustomFieldConfig(row.config),
      value: {
        value_text: typeof row.value_text === "string" ? row.value_text : null,
        value_number: valueNumber !== null && Number.isFinite(valueNumber) ? valueNumber : null,
        value_date: typeof row.value_date === "string" ? row.value_date : null,
        value_json: row.value_json ?? null,
      },
    },
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

/**
 * Whether a task's stored value for a field equals what writing `value` would
 * store. Read only, with no access check: callers have already read the task.
 * A field that is deleted, belongs to another project or rejects the value
 * counts as a mismatch.
 */
export async function taskCustomValueMatches(
  actor: Actor,
  taskId: number,
  fieldId: number,
  value: unknown,
): Promise<boolean> {
  const field = await db.query(
    `SELECT f.field_type, f.config
       FROM custom_fields f JOIN tasks t ON t.project_id = f.project_id
      WHERE t.id = $1::bigint AND f.id = $2::bigint AND f.deleted_at IS NULL`,
    [taskId, fieldId],
  );
  if (field.rowCount === 0) return false;
  const normalized = await normalizeTaskCustomValue(field.rows[0], value, actor.uid, db);
  if (!normalized.ok) return false;
  const stored = await db.query(
    `SELECT value_text, value_number, value_date::text AS value_date, value_json
       FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint`,
    [taskId, fieldId],
  );
  return equalTaskCustomValue(stored.rows[0], normalized.value);
}
