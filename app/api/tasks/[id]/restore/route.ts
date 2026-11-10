import { NextResponse } from "next/server";
import { logEvent } from "@/lib/data";
import { notifyTask } from "@/lib/notify";
import { withTask } from "@/lib/api/route";
import { mutateTaskTrees } from "@/lib/services/task-tree-mutation";

// Restore a soft-deleted task subtree.
export const POST = withTask("edit", async (_req, { taskId, uid, projectId }) => {
  const restored = await mutateTaskTrees(new Map([[taskId, projectId]]), "restore");
  if (restored === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyTask(taskId);
  await logEvent(taskId, uid, "restored", "タスクをゴミ箱から復元しました").catch(
    () => undefined,
  );
  return NextResponse.json({ restored: taskId });
}, { taskScope: "primary" });
