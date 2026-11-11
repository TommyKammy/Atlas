import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { withResourceProject } from "@/lib/api/route";

export const POST = withResourceProject("configure", "custom_fields", async (_req, { params }) => {
  const id = params.id;
  const r = await db.query(
    `UPDATE custom_fields SET deleted_at = NULL
     WHERE id = $1::bigint AND deleted_at IS NOT NULL
     RETURNING id, project_id`,
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(Number(r.rows[0].project_id));
  return NextResponse.json({ restored: Number(id) });
});
