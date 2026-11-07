import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { withResourceProject } from "@/lib/api/route";

export const DELETE = withResourceProject("edit", "saved_views", async (_req, { projectId, params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM saved_views WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(projectId);
  return NextResponse.json({ deleted: Number(id) });
});
