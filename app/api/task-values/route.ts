import { NextResponse } from "next/server";
import { withTask } from "@/lib/api/route";
import { setTaskCustomValue } from "@/lib/services/task-custom-values";

// Upsert one task's custom-field value. The field type determines which
// typed column is written; empty values remove the row.
export const POST = withTask("edit", async (_req, { uid, taskId, body }) => {
  const { field_id, value } = (body ?? {}) as { field_id?: unknown; value?: unknown };
  const result = await setTaskCustomValue(
    { uid, source: "web" },
    { task_id: taskId, field_id, value },
  );
  return NextResponse.json(
    result.cleared
      ? { cleared: true, updated_at: result.updated_at }
      : { ok: true, updated_at: result.updated_at },
    { status: result.cleared ? 200 : 201 },
  );
}, { body: true });
