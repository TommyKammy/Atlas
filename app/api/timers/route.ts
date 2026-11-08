import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyField, notifyTask } from "@/lib/notify";
import { withTask } from "@/lib/api/route";
import { formatDuration, normalizeCustomFieldConfig } from "@/lib/custom-fields";
import { canEditFieldValue } from "@/lib/field-access";

type TimerJson = { running_since?: string | null };

function runningSince(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as TimerJson).running_since;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Start/stop/reset a timer custom field. Elapsed seconds are stored in value_number. */
export const POST = withTask("edit", async (_req, { uid, taskId, projectId, body }) => {
  const { field_id, action } = (body ?? {}) as { field_id?: number; action?: string };
  if (!field_id || !["start", "stop", "reset"].includes(action ?? "")) {
    return NextResponse.json({ error: "field_id and action (start|stop|reset) are required" }, { status: 400 });
  }
  const field = await db.query(
    "SELECT field_type, project_id, config, access_level, editor_ids FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL",
    [field_id],
  );
  if (
    field.rowCount === 0 ||
    Number(field.rows[0].project_id) !== projectId ||
    field.rows[0].field_type !== "timer"
  ) {
    return NextResponse.json({ error: "timer field not found" }, { status: 404 });
  }
  if (!(await canEditFieldValue(uid, projectId, field.rows[0]))) {
    return NextResponse.json({ error: "field access denied" }, { status: 403 });
  }
  const config = normalizeCustomFieldConfig(field.rows[0].config);
  const current = await db.query(
    "SELECT value_number, value_json FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint",
    [taskId, field_id],
  );
  const total = Number(current.rows[0]?.value_number ?? 0);
  const started = runningSince(current.rows[0]?.value_json);

  if (action === "reset") {
    await db.query(
      "DELETE FROM task_custom_values WHERE task_id = $1::bigint AND field_id = $2::bigint",
      [taskId, field_id],
    );
    await notifyTask(taskId);
    await notifyField(field_id);
    return NextResponse.json({ ok: true, total_seconds: 0, running_since: null });
  }

  if (action === "start") {
    if (started) {
      return NextResponse.json({ ok: true, total_seconds: total, running_since: started });
    }
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO task_custom_values (task_id, field_id, value_number, value_json)
       VALUES ($1::bigint, $2::bigint, $3, $4::jsonb)
       ON CONFLICT (task_id, field_id) DO UPDATE SET
         value_number = EXCLUDED.value_number,
         value_json = EXCLUDED.value_json`,
      [taskId, field_id, total, JSON.stringify({ running_since: now })],
    );
    await notifyTask(taskId);
    await notifyField(field_id);
    return NextResponse.json({ ok: true, total_seconds: total, running_since: now });
  }

  const elapsed = started ? Math.max(0, (Date.now() - Date.parse(started)) / 1000) : 0;
  const nextTotal = total + elapsed;
  await db.query(
    `INSERT INTO task_custom_values (task_id, field_id, value_number, value_text, value_json)
     VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb)
     ON CONFLICT (task_id, field_id) DO UPDATE SET
       value_number = EXCLUDED.value_number,
       value_text = EXCLUDED.value_text,
       value_json = EXCLUDED.value_json`,
    [
      taskId,
      field_id,
      nextTotal,
      formatDuration(nextTotal, config),
      JSON.stringify({ running_since: null }),
    ],
  );
  await notifyTask(taskId);
  await notifyField(field_id);
  return NextResponse.json({ ok: true, total_seconds: nextTotal, running_since: null });
}, { body: true });
