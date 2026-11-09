import { NextResponse } from "next/server";
import { withTask } from "@/lib/api/route";
import { createFollowUpTask } from "@/lib/services/task-copy";

/** Create a follow-up task in the same project/section. */
export const POST = withTask("edit", async (_req, { taskId, uid, projectId }) => {
  const created = await createFollowUpTask({ taskId, uid, projectId });
  return NextResponse.json(created, { status: 201 });
});
