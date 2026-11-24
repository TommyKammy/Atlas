import type { CustomValue } from "../custom-fields";
import { db } from "../db";
import { canEditFieldValue } from "../field-access";
import { equalTaskCustomValue, isEmptyTaskCustomValue, normalizeTaskCustomValue } from "../task-custom-value";

import type { CapabilityContext, CapabilityResult } from "./shared";
import { actionTaskId, asNumber, assertEdit, finishTaskAction, taskProject } from "./shared";

export async function taskSetCustomField(params: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult> {
  const q = ctx.q ?? db;
  const taskId = actionTaskId(params, ctx.event);
  if (!taskId) throw new Error("task.set_custom_field requires a task");
  const projectId = await taskProject(taskId, q);
  await assertEdit(ctx, projectId);
  const fieldId = asNumber(params.field_id);
  if (!fieldId) throw new Error("field_id is required");
  const field = await q.query(
    `SELECT id, name, field_type, project_id, config, access_level, editor_ids
     FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL`,
    [fieldId],
  );
  if (field.rowCount === 0 || Number(field.rows[0].project_id) !== projectId) {
    throw new Error("custom field not found");
  }
  if (!(await canEditFieldValue(ctx.actorId, projectId, field.rows[0], q))) {
    throw new Error("field access denied");
  }
  const value = params.value;
  const normalized = await normalizeTaskCustomValue(field.rows[0], value, ctx.actorId, q);
  if (!normalized.ok) throw new Error(`invalid custom field value: ${normalized.error}`);
  const current = await q.query(
    `SELECT value_text, value_number, value_date::text AS value_date, value_json
     FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint`,
    [taskId, fieldId],
  );
  if (equalTaskCustomValue(current.rows[0] as CustomValue | undefined, normalized.value)) {
    return { summary: "カスタムフィールドの値は変更されませんでした", data: { unchanged: true } };
  }
  const { value_text: text, value_number: num, value_date: date, value_json: json } = normalized.value;
  if (isEmptyTaskCustomValue(normalized.value)) {
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
  // Keep compare-and-set callers consistent with API/MCP custom-field writes:
  // a changed value advances the task stamp in the same transaction.
  await q.query(
    "UPDATE tasks SET updated_at = now() WHERE id = $1::bigint",
    [taskId],
  );
  return finishTaskAction(
    ctx,
    taskId,
    "task.custom_field_changed",
    { field_id: fieldId, field_name: field.rows[0].name, value },
    `カスタムフィールド「${field.rows[0].name}」を更新しました`,
  );
}
