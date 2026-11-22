import { NextResponse } from "next/server";
import { withTask } from "@/lib/api/route";
import { addComment } from "@/lib/services/comments";

export const POST = withTask("comment", async (_req, { taskId, uid, body }) => {
  const { id } = await addComment(
    { uid, source: "web" },
    { ...(body as Record<string, unknown>), task_id: taskId },
  );
  return NextResponse.json({ id }, { status: 201 });
}, { body: true });
