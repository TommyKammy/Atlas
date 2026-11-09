import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import type { BundleField, BundleRule } from "@/lib/bundles";
import { validateRuleDefinition } from "@/lib/automation/validate";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const POST = withProject("edit", async (_req, { uid, projectId, params }) => {
  const id = params.id;
  const created = await withTransaction(async (q) => {
    const bundle = await q.query(
      `SELECT b.id, b.fields, b.rules, p.workspace_id
       FROM bundles b JOIN projects p ON p.workspace_id = b.workspace_id
       WHERE b.id = $1::bigint AND p.id = $2::bigint`,
      [id, projectId],
    );
    if (bundle.rowCount === 0) return null;
    const alreadyApplied = await q.query(
      "SELECT 1 FROM bundle_applications WHERE bundle_id = $1::bigint AND project_id = $2::bigint",
      [id, projectId],
    );
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
    let createdRules = 0;
    const rules = (bundle.rows[0].rules ?? []) as BundleRule[];
    if (!alreadyApplied.rowCount && Array.isArray(rules)) {
      for (const rule of rules.slice(0, 50)) {
        const validated = validateRuleDefinition(rule.definition);
        if (!validated.ok) continue;
        await q.query(
          `INSERT INTO project_rules (
             workspace_id, project_id, name, description, definition, owner_id, enabled
           ) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb, $6::bigint, $7)`,
          [
            Number(bundle.rows[0].workspace_id),
            projectId,
            rule.name.slice(0, 120),
            (rule.description ?? "").slice(0, 1000),
            JSON.stringify(validated.definition),
            uid,
            rule.enabled !== false,
          ],
        );
        createdRules += 1;
      }
    }
    await q.query(
      `INSERT INTO bundle_applications (bundle_id, project_id, applied_by)
       VALUES ($1::bigint, $2::bigint, $3)
       ON CONFLICT (bundle_id, project_id) DO NOTHING`,
      [id, projectId, uid],
    );
    return { fields: count, rules: createdRules };
  });
  if (created === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyProject(projectId);
  await audit(uid, "bundle.apply", {
    entity: "bundle",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json(
    { ok: true, applied: true, created_fields: created.fields, created_rules: created.rules },
    { status: 201 },
  );
}, {
  body: true,
  resolveProjectId: (_req, _params, body) =>
    Number((body as { project_id?: unknown } | null)?.project_id),
});
