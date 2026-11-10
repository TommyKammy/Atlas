import { NextResponse } from "next/server";
import { withTask } from "@/lib/api/route";
import { getTaskApproval, updateTaskApproval } from "@/lib/services/task-approval";

export const GET = withTask("view", async (_req, { taskId, uid }) =>
  NextResponse.json(await getTaskApproval(taskId, uid)));

export const POST = withTask("edit", async (_req, { taskId, uid, body }) =>
  NextResponse.json(await updateTaskApproval(taskId, uid, body)), { body: true, taskScope: "primary" });
