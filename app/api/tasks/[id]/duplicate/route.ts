import { NextResponse } from "next/server";
import { withTask } from "@/lib/api/route";
import { duplicateTask } from "@/lib/services/task-copy";

/** Duplicate one task (fields + custom-field values) into the same project/section. */
export const POST = withTask("edit", async (_req, { taskId, uid, projectId }) => {
  const created = await duplicateTask({ taskId, uid, projectId });
  return NextResponse.json(created, { status: 201 });
}, { taskScope: "primary" });
