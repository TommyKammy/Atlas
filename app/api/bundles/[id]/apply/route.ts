import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import type { BundleField } from "@/lib/bundles";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const projectId = Number(body?.project_id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const bundle = await db.query(
    `SELECT b.id, b.fields
     FROM bundles b JOIN projects p ON p.workspace_id = b.workspace_id
     WHERE b.id = $1::bigint AND p.id = $2::bigint`,
    [id, projectId],
  );
  if (bundle.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const fields = (bundle.rows[0].fields ?? []) as BundleField[];
  const existing = await db.query("SELECT name FROM custom_fields WHERE project_id = $1", [projectId]);
  const existingNames = new Set<string>(existing.rows.map((row) => String(row.name)));
  const max = await db.query(
    "SELECT COALESCE(MAX(position), 0) AS position FROM custom_fields WHERE project_id = $1",
    [projectId],
  );
  let position = Number(max.rows[0].position);
  let created = 0;
  for (const field of fields) {
    if (existingNames.has(field.name)) continue;
    position += 1000;
    await db.query(
      `INSERT INTO custom_fields (project_id, name, field_type, options, position)
       VALUES ($1::bigint, $2, $3, $4::jsonb, $5)`,
      [projectId, field.name, field.field_type, JSON.stringify(field.options ?? []), position],
    );
    existingNames.add(field.name);
    created += 1;
  }
  await db.query(
    `INSERT INTO bundle_applications (bundle_id, project_id, applied_by)
     VALUES ($1::bigint, $2::bigint, $3)
     ON CONFLICT (bundle_id, project_id) DO NOTHING`,
    [id, projectId, getCurrentUserIdFromRequest(req)],
  );
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "bundle.apply", {
    entity: "bundle",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ ok: true, applied: true, created_fields: created }, { status: 201 });
}
