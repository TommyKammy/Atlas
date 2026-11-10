import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";
import { detachMultiHomedTasks } from "@/lib/project-delete";

/** Move a project to the workspace trash without losing its tasks. */
export const POST = withProject("admin", async (_req, { uid, projectId }) => {
  const movedTasks = await withTransaction(async (q) => {
    const moved = await detachMultiHomedTasks(q, projectId);
    await q.query(
      `UPDATE projects
       SET deleted_at = now(), deleted_by = $2,
           archived_at = COALESCE(archived_at, now())
       WHERE id = $1::bigint`,
      [projectId, uid],
    );
    return moved;
  });
  await audit(uid, "project.trash", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: `multi-homed tasks moved: ${movedTasks}`,
  });
  return NextResponse.json({ trashed: projectId, moved_tasks: movedTasks });
});

/** Permanently delete a project already in the trash. */
export const DELETE = withProject(
  "admin",
  async (_req, { uid, projectId }) => {
    const movedTasks = await withTransaction(async (q) => {
      const moved = await detachMultiHomedTasks(q, projectId);
      const existing = await q.query("SELECT 1 FROM projects WHERE id = $1::bigint", [projectId]);
      if (existing.rowCount) {
        await audit(uid, "project.delete", {
          entity: "project",
          entityId: projectId,
          projectId,
          summary: `permanent delete; multi-homed tasks moved: ${moved}`,
        }, q);
      }
      await q.query("DELETE FROM projects WHERE id = $1::bigint", [projectId]);
      return moved;
    });
    return NextResponse.json({ deleted: projectId, moved_tasks: movedTasks });
  },
  { allowDeleted: true },
);
