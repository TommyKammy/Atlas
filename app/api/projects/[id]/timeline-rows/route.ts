import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { audit } from "@/lib/audit";
import { notifyProject } from "@/lib/notify";

/** Clear manual timeline rows for a whole project or one section. */
export const DELETE = withProject(
  "edit",
  async (_req, { uid, projectId, body }) => {
    const payload = (body ?? {}) as { section_id?: unknown };
    const rawSection = payload.section_id;
    let sectionId: number | null = null;
    if (rawSection !== undefined && rawSection !== null && rawSection !== "") {
      sectionId = Number(rawSection);
      if (!Number.isInteger(sectionId) || sectionId <= 0) {
        return NextResponse.json({ error: "invalid section_id" }, { status: 400 });
      }
      const section = await db.query(
        "SELECT id FROM sections WHERE id = $1::bigint AND project_id = $2::bigint",
        [sectionId, projectId],
      );
      if (section.rowCount === 0) {
        return NextResponse.json({ error: "section not found" }, { status: 404 });
      }
    }

    const result =
      sectionId === null
        ? await db.query("DELETE FROM task_timeline_rows WHERE project_id = $1::bigint", [projectId])
        : await db.query(
            `DELETE FROM task_timeline_rows tr
             USING tasks t
             WHERE tr.task_id = t.id
               AND tr.project_id = $1::bigint
               AND (
                 t.section_id = $2::bigint
                 OR EXISTS (
                   SELECT 1 FROM task_project_memberships m
                   WHERE m.task_id = t.id
                     AND m.project_id = $1::bigint
                     AND m.section_id = $2::bigint
                 )
               )`,
            [projectId, sectionId],
          );
    await audit(uid, "task.timeline_rows.reset", {
      entity: "project",
      entityId: projectId,
      projectId,
      summary: sectionId === null ? "all" : `section ${sectionId}`,
    });
    await notifyProject(projectId);
    return NextResponse.json({ deleted: result.rowCount ?? 0 });
  },
  { body: true },
);
