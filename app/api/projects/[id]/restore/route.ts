import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";

/** Restore a soft-deleted project from the trash. */
export const POST = withProject(
  "admin",
  async (_req, { uid, projectId }) => {
    const r = await db.query(
      `UPDATE projects
       SET deleted_at = NULL, deleted_by = NULL, archived_at = NULL
       WHERE id = $1::bigint AND deleted_at IS NOT NULL
       RETURNING id`,
      [projectId],
    );
    if (r.rowCount === 0) return NextResponse.json({ error: "not found in trash" }, { status: 404 });
    await audit(uid, "project.restore", {
      entity: "project",
      entityId: projectId,
      projectId,
    });
    return NextResponse.json({ restored: projectId });
  },
  { allowDeleted: true },
);
