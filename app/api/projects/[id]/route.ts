import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";
import { detachMultiHomedTasks } from "@/lib/project-delete";
import { ProjectUpdateConflict, updateProject } from "@/lib/services/projects";

export const DELETE = withProject("admin", async (_req, { uid, projectId }) => {
  const movedTasks = await withTransaction(async (q) => {
    const moved = await detachMultiHomedTasks(q, projectId);
    // Another authorized DELETE may have completed while this request waited
    // for the deletion gate. Keep that retry idempotent without a stale audit FK.
    const existing = await q.query("SELECT 1 FROM projects WHERE id = $1::bigint", [projectId]);
    if (existing.rowCount) {
      await audit(uid, "project.delete", {
        entity: "project",
        entityId: projectId,
        projectId,
        summary: `hard delete; multi-homed tasks moved: ${moved}`,
      }, q);
    }
    await q.query("DELETE FROM projects WHERE id = $1::bigint", [projectId]);
    return moved;
  });
  return NextResponse.json({ deleted: projectId, moved_tasks: movedTasks });
});

export const PATCH = withProject("configure", async (req, { uid, projectId }) => {
  const body = await req.json().catch(() => ({}));
  try {
    const result = await updateProject({ uid, source: "web" }, projectId, body);
    return NextResponse.json(result);
  } catch (error) {
    // Keep the customize screen's flat 409 body instead of nesting the current
    // status-options row under ApiError.details.
    if (error instanceof ProjectUpdateConflict) {
      return NextResponse.json({ error: error.message, ...error.current }, { status: error.status });
    }
    throw error;
  }
});
