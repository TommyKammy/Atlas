import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await db.query(
    "SELECT project_id, is_custom FROM project_tabs WHERE id = $1::bigint",
    [id],
  );
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!owner.rows[0].is_custom) return NextResponse.json({ error: "built-in tab" }, { status: 400 });
  const projectId = Number(owner.rows[0].project_id);
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  if (typeof body.name !== "string" || body.name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  await db.query("UPDATE project_tabs SET name = $1 WHERE id = $2::bigint", [
    body.name.trim(),
    id,
  ]);
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "project_tab.update", {
    entity: "project_tab",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ id: Number(id) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await db.query(
    "SELECT project_id, is_custom FROM project_tabs WHERE id = $1::bigint",
    [id],
  );
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!owner.rows[0].is_custom) return NextResponse.json({ error: "built-in tab" }, { status: 400 });
  const projectId = Number(owner.rows[0].project_id);
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await db.query("DELETE FROM project_tabs WHERE id = $1::bigint", [id]);
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "project_tab.delete", {
    entity: "project_tab",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ deleted: Number(id) });
}
