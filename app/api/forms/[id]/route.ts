import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withResourceProject } from "@/lib/api/route";
import { normalizeFormFields } from "@/lib/forms";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const PATCH = withResourceProject("configure", "project_forms", async (_req, { uid, projectId, params, body }) => {
  const id = params.id;
  const payload = (body ?? {}) as { name?: unknown; description?: unknown; fields?: unknown; published?: unknown };
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof payload.name === "string" && payload.name.trim() !== "") {
    values.push(payload.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (typeof payload.description === "string") {
    values.push(payload.description.trim());
    sets.push(`description = $${values.length}`);
  }
  if (payload.fields !== undefined) {
    const normalized = normalizeFormFields(payload.fields);
    if (!normalized) return NextResponse.json({ error: "invalid fields" }, { status: 400 });
    values.push(JSON.stringify(normalized));
    sets.push(`fields = $${values.length}::jsonb`);
  }
  if (typeof payload.published === "boolean") {
    values.push(payload.published);
    sets.push(`published = $${values.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(id);
  await db.query(
    `UPDATE project_forms SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
  await notifyProject(projectId);
  await audit(uid, "form.update", {
    entity: "form",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ id: Number(id) });
}, { body: true });

export const DELETE = withResourceProject("configure", "project_forms", async (_req, { uid, projectId, params }) => {
  const id = params.id;
  await db.query("DELETE FROM project_forms WHERE id = $1::bigint", [id]);
  await notifyProject(projectId);
  await audit(uid, "form.delete", {
    entity: "form",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ deleted: Number(id) });
});
