import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { normalizeFormFields } from "@/lib/forms";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await db.query("SELECT project_id FROM project_forms WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const projectId = Number(owner.rows[0].project_id);
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim() !== "") {
    values.push(body.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (typeof body.description === "string") {
    values.push(body.description.trim());
    sets.push(`description = $${values.length}`);
  }
  if (body.fields !== undefined) {
    const normalized = normalizeFormFields(body.fields);
    if (!normalized) return NextResponse.json({ error: "invalid fields" }, { status: 400 });
    values.push(JSON.stringify(normalized));
    sets.push(`fields = $${values.length}::jsonb`);
  }
  if (typeof body.published === "boolean") {
    values.push(body.published);
    sets.push(`published = $${values.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(id);
  await db.query(
    `UPDATE project_forms SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "form.update", {
    entity: "form",
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
  const owner = await db.query("SELECT project_id FROM project_forms WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const projectId = Number(owner.rows[0].project_id);
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await db.query("DELETE FROM project_forms WHERE id = $1::bigint", [id]);
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "form.delete", {
    entity: "form",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ deleted: Number(id) });
}
