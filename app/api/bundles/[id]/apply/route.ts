import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import type { BundleField } from "@/lib/bundles";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const POST = withProject("edit", async (_req, { uid, projectId, params }) => {
  const id = params.id;
  const created = await withTransaction(async (q) => {
    const bundle = await q.query(
      `SELECT b.id, b.fields
       FROM bundles b JOIN projects p ON p.workspace_id = b.workspace_id
       WHERE b.id = $1::bigint AND p.id = $2::bigint`,
      [id, projectId],
    );
    if (bundle.rowCount === 0) return null;
    const fields = (bundle.rows[0].fields ?? []) as BundleField[];
    const existing = await q.query("SELECT name FROM custom_fields WHERE project_id = $1", [projectId]);
    const existingNames = new Set<string>(existing.rows.map((row) => String(row.name)));
    const max = await q.query(
      "SELECT COALESCE(MAX(position), 0) AS position FROM custom_fields WHERE project_id = $1",
      [projectId],
    );
    let position = Number(max.rows[0].position);
    let count = 0;
    for (const field of fields) {
      if (existingNames.has(field.name)) continue;
      position += 1000;
      await q.query(
        `INSERT INTO custom_fields (project_id, name, field_type, options, position)
         VALUES ($1::bigint, $2, $3, $4::jsonb, $5)`,
        [projectId, field.name, field.field_type, JSON.stringify(field.options ?? []), position],
      );
      existingNames.add(field.name);
      count += 1;
    }
    await q.query(
      `INSERT INTO bundle_applications (bundle_id, project_id, applied_by)
       VALUES ($1::bigint, $2::bigint, $3)
       ON CONFLICT (bundle_id, project_id) DO NOTHING`,
      [id, projectId, uid],
    );
    return count;
  });
  if (created === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(projectId);
  await audit(uid, "bundle.apply", {
    entity: "bundle",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ ok: true, applied: true, created_fields: created }, { status: 201 });
}, {
  body: true,
  resolveProjectId: (_req, _params, body) =>
    Number((body as { project_id?: unknown } | null)?.project_id),
});
