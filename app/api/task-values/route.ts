import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { notifyField, notifyTask } from "@/lib/notify";
import { withTask } from "@/lib/api/route";
import { canEditFieldValue } from "@/lib/field-access";
import { emitTaskEvent } from "@/lib/domain/events";
import { isEmptyTaskCustomValue, normalizeTaskCustomValue } from "@/lib/task-custom-value";

// Upsert one task's custom-field value. The field type determines which
// typed column is written; empty values remove the row.
export const POST = withTask("edit", async (_req, { uid, taskId: task_id, projectId, body }) => {
  const { field_id, value } = (body ?? {}) as { field_id?: number; value?: unknown };
  if (!field_id) {
    return NextResponse.json({ error: "task_id and field_id are required" }, { status: 400 });
  }
  const result = await withTransaction(async (q) => {
    const task = await q.query("SELECT id FROM tasks WHERE id = $1::bigint AND deleted_at IS NULL FOR UPDATE", [task_id]);
    if (task.rowCount === 0) return { error: "task not found", status: 404 };
    const f = await q.query(
      `SELECT name, field_type, project_id, config, access_level, editor_ids FROM custom_fields
       WHERE id = $1::bigint AND deleted_at IS NULL FOR SHARE`,
      [field_id],
    );
    if (f.rowCount === 0 || Number(f.rows[0].project_id) !== projectId) {
      return { error: "field not found", status: 404 };
    }
    if (!(await canEditFieldValue(uid, projectId, f.rows[0], q))) {
      return { error: "field access denied", status: 403 };
    }
    const normalized = await normalizeTaskCustomValue(f.rows[0], value, uid, q);
    if (!normalized.ok) return normalized;
    const { value_text: text, value_number: num, value_date: date, value_json: json } = normalized.value;
    const cleared = isEmptyTaskCustomValue(normalized.value);
    if (cleared) {
      await q.query(
        "DELETE FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint",
        [task_id, field_id],
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
        [task_id, field_id, text, num, date, json === null ? null : JSON.stringify(json)],
      );
    }
    await emitTaskEvent({
      projectId, taskId: task_id, actorId: uid, type: "task.custom_field_changed",
      data: { field_id, field_name: f.rows[0].name, value: cleared ? null : value, ...(cleared ? { cleared: true } : {}) },
    }, q);
    return { cleared };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  await Promise.all([notifyTask(task_id), notifyField(field_id)]);
  return NextResponse.json(result.cleared ? { cleared: true } : { ok: true }, { status: result.cleared ? 200 : 201 });
}, { body: true });
