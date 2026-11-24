import { NextResponse } from "next/server";
import { withTask } from "@/lib/api/route";
import { setTaskCustomValue, taskCustomFieldConflictState } from "@/lib/services/task-custom-values";
import { TaskMutationFailure } from "@/lib/services/task-mutation-failure";

// Upsert one task's custom-field value. The field type determines which
// typed column is written; empty values remove the row.
export const POST = withTask("edit", async (_req, { uid, taskId, projectId, body }) => {
  const { field_id, value, expected_updated_at } = (body ?? {}) as {
    field_id?: unknown;
    value?: unknown;
    expected_updated_at?: unknown;
  };
  try {
    const result = await setTaskCustomValue(
      { uid, source: "web" },
      { task_id: taskId, field_id, value, expected_updated_at },
    );
    return NextResponse.json(
      result.cleared
        ? { cleared: true, updated_at: result.updated_at }
        : { ok: true, updated_at: result.updated_at },
      { status: result.cleared ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof TaskMutationFailure && error.reason === "conflict") {
      const { updated_at, current, custom_field } = await taskCustomFieldConflictState(
        taskId,
        projectId,
        field_id,
      );
      return NextResponse.json(
        {
          error: error.message,
          updated_at,
          current,
          ...(custom_field ? { custom_field } : {}),
        },
        { status: 409 },
      );
    }
    throw error;
  }
}, { body: true });
