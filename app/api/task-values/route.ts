import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyField, notifyTask } from "@/lib/notify";
import { withTask } from "@/lib/api/route";
import { isReadOnlyFieldType, type CustomFieldType } from "@/lib/custom-fields";
import { canEditFieldValue } from "@/lib/field-access";

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Upsert one task's custom-field value. The field type determines which
// typed column is written; empty values remove the row.
export const POST = withTask("edit", async (_req, { uid, taskId: task_id, projectId, body }) => {
  const { field_id, value } = (body ?? {}) as { field_id?: number; value?: unknown };
  if (!field_id) {
    return NextResponse.json({ error: "task_id and field_id are required" }, { status: 400 });
  }
  const f = await db.query(
    "SELECT field_type, project_id, config, access_level, editor_ids FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL",
    [field_id],
  );
  if (f.rowCount === 0 || Number(f.rows[0].project_id) !== projectId) {
    return NextResponse.json({ error: "field not found" }, { status: 404 });
  }
  if (!(await canEditFieldValue(uid, projectId, f.rows[0]))) {
    return NextResponse.json({ error: "field access denied" }, { status: 403 });
  }
  const fieldType = f.rows[0].field_type as CustomFieldType;
  if (fieldType === "timer") {
    return NextResponse.json({ error: "use the timer endpoint" }, { status: 400 });
  }
  if (isReadOnlyFieldType(fieldType)) {
    return NextResponse.json({ error: "this field is read-only" }, { status: 400 });
  }

  let text: string | null = null;
  let num: number | null = null;
  let date: string | null = null;
  let json: unknown = null;

  if (fieldType === "number") {
    num = value !== null && value !== "" ? Number(value) : null;
    if (num !== null && !Number.isFinite(num)) {
      return NextResponse.json({ error: "numeric value required" }, { status: 400 });
    }
  } else if (fieldType === "date") {
    const raw = typeof value === "string" ? value : "";
    date = raw === "" ? null : raw;
    if (date !== null && !validDate(date)) {
      return NextResponse.json({ error: "invalid date" }, { status: 400 });
    }
    text = date;
  } else if (fieldType === "reference") {
    const ids = (Array.isArray(value) ? value : [])
      .map((item) => Number(item))
      .filter((item, index, all) => Number.isInteger(item) && item > 0 && all.indexOf(item) === index);
    if (ids.length > 0) {
      const sourceIds = Array.isArray(f.rows[0].config?.source_project_ids)
        ? f.rows[0].config.source_project_ids.map((item: unknown) => Number(item)).filter((item: number) => Number.isInteger(item))
        : [];
      const tasks = await db.query(
        `SELECT t.id, t.name FROM tasks t
         WHERE t.id = ANY($1::bigint[]) AND t.deleted_at IS NULL
           AND ($2::bigint[] = '{}'::bigint[] OR t.project_id = ANY($2::bigint[]) OR EXISTS (
             SELECT 1 FROM task_project_memberships m
             WHERE m.task_id = t.id AND m.project_id = ANY($2::bigint[])
           ))`,
        [ids, sourceIds],
      );
      if (tasks.rowCount !== ids.length) {
        return NextResponse.json({ error: "invalid reference" }, { status: 400 });
      }
      const byId = new Map(tasks.rows.map((row) => [Number(row.id), String(row.name)]));
      json = ids;
      text = ids.map((id) => byId.get(id)).filter(Boolean).join(", ");
    }
  } else if (fieldType === "people") {
    const ids = (Array.isArray(value) ? value : [])
      .map((item) => Number(item))
      .filter((item, index, all) => Number.isInteger(item) && item > 0 && all.indexOf(item) === index);
    if (ids.length > 0) {
      const users = await db.query(
        "SELECT id, name FROM users WHERE id = ANY($1::bigint[]) AND deactivated_at IS NULL",
        [ids],
      );
      if (users.rowCount !== ids.length) {
        return NextResponse.json({ error: "invalid member" }, { status: 400 });
      }
      const byId = new Map(users.rows.map((row) => [Number(row.id), String(row.name)]));
      json = ids;
      text = ids.map((id) => byId.get(id)).filter(Boolean).join(", ");
    }
  } else if (fieldType === "multi_select") {
    const selected = Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter((item) => item !== "")
      : typeof value === "string"
        ? value.split(",").map((item) => item.trim()).filter((item) => item !== "")
        : [];
    if (selected.length > 0) {
      json = selected;
      text = selected.join(", ");
    }
  } else {
    text = value !== null && value !== "" ? String(value) : null;
  }

  const empty =
    text === null &&
    num === null &&
    date === null &&
    (json === null || (Array.isArray(json) && json.length === 0));

  if (empty) {
    await db.query(
      "DELETE FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint",
      [task_id, field_id],
    );
    await notifyTask(task_id);
    await notifyField(field_id);
    return NextResponse.json({ cleared: true });
  }

  await db.query(
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
  await notifyTask(task_id);
  await notifyField(field_id);
  return NextResponse.json({ ok: true }, { status: 201 });
}, { body: true });
