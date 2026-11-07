import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withResourceProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const PATCH = withResourceProject("edit", "project_tabs", async (_req, { uid, projectId, params, body }) => {
  const id = params.id;
  const owner = await db.query("SELECT is_custom FROM project_tabs WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!owner.rows[0].is_custom) return NextResponse.json({ error: "built-in tab" }, { status: 400 });
  const payload = (body ?? {}) as { name?: unknown };
  if (typeof payload.name !== "string" || payload.name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  await db.query("UPDATE project_tabs SET name = $1 WHERE id = $2::bigint", [
    payload.name.trim(),
    id,
  ]);
  await notifyProject(projectId);
  await audit(uid, "project_tab.update", {
    entity: "project_tab",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ id: Number(id) });
}, { body: true });

export const DELETE = withResourceProject("edit", "project_tabs", async (_req, { uid, projectId, params }) => {
  const id = params.id;
  const owner = await db.query("SELECT is_custom FROM project_tabs WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!owner.rows[0].is_custom) return NextResponse.json({ error: "built-in tab" }, { status: 400 });
  await db.query("DELETE FROM project_tabs WHERE id = $1::bigint", [id]);
  await notifyProject(projectId);
  await audit(uid, "project_tab.delete", {
    entity: "project_tab",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ deleted: Number(id) });
});
