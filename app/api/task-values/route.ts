import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyField, notifyTask } from "@/lib/notify";
import { withTask } from "@/lib/api/route";

// Upsert a task's value for a custom field. `value` is a number for number
// fields, a string otherwise. Null/empty clears the value but keeps no row.
export const POST = withTask("edit", async (_req, { taskId: task_id, projectId, body }) => {
  const { field_id, value } = (body ?? {}) as { field_id?: number; value?: unknown };
  if (!field_id) {
    return NextResponse.json({ error: "task_id and field_id are required" }, { status: 400 });
  }
  const f = await db.query("SELECT field_type, project_id FROM custom_fields WHERE id = $1::bigint", [field_id]);
  if (f.rowCount === 0 || Number(f.rows[0].project_id) !== projectId) {
    return NextResponse.json({ error: "field not found" }, { status: 404 });
  }
  const isNumber = f.rows[0].field_type === "number";
  const num = isNumber && value !== null && value !== "" ? Number(value) : null;
  const text = !isNumber && value !== null && value !== "" ? String(value) : null;
  if (isNumber && num !== null && !Number.isFinite(num)) {
    return NextResponse.json({ error: "numeric value required" }, { status: 400 });
  }
  if (num === null && text === null) {
    await db.query(
      "DELETE FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint",
      [task_id, field_id],
    );
    await notifyTask(task_id);
    await notifyField(field_id);
    return NextResponse.json({ cleared: true });
  }
  await db.query(
    `INSERT INTO task_custom_values (task_id, field_id, value_text, value_number)
     VALUES ($1::bigint, $2::bigint, $3, $4)
     ON CONFLICT (task_id, field_id) DO UPDATE SET value_text = EXCLUDED.value_text, value_number = EXCLUDED.value_number`,
    [task_id, field_id, text, num],
  );
  await notifyTask(task_id);
  await notifyField(field_id);
  return NextResponse.json({ ok: true }, { status: 201 });
}, { body: true });
