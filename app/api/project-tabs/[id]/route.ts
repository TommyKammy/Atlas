import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withResourceProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const PATCH = withResourceProject("edit", "project_tabs", async (_req, { uid, projectId, params, body }) => {
  const id = params.id;
  const owner = await db.query("SELECT id FROM project_tabs WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const payload = (body ?? {}) as { name?: unknown };
  if (typeof payload.name !== "string" || payload.name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const name = payload.name.trim().slice(0, 120);
  await db.query("UPDATE project_tabs SET name = $1 WHERE id = $2::bigint", [name, id]);
  await notifyProject(projectId);
  await audit(uid, "project_tab.update", {
    entity: "project_tab",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ id: Number(id), name });
}, { body: true });

export const DELETE = withResourceProject("edit", "project_tabs", async (_req, { uid, projectId, params }) => {
  const id = params.id;
  const owner = await db.query("SELECT id FROM project_tabs WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const count = await db.query(
    "SELECT COUNT(*)::int AS n FROM project_tabs WHERE project_id = $1::bigint",
    [projectId],
  );
  if (Number(count.rows[0].n) <= 1) {
    return NextResponse.json({ error: "cannot delete the last tab" }, { status: 400 });
  }
  await db.query("DELETE FROM project_tabs WHERE id = $1::bigint", [id]);
  await notifyProject(projectId);
  await audit(uid, "project_tab.delete", {
    entity: "project_tab",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ deleted: Number(id) });
});
