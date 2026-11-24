import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdmin } from "@/lib/api/route";
import { normalizeBundleFields, normalizeBundleRules, type BundleRule } from "@/lib/bundles";
import { validateRuleDefinition } from "@/lib/automation/validate";
import { audit } from "@/lib/audit";

function validatedRules(input: unknown): BundleRule[] | null {
  const rules = normalizeBundleRules(input);
  if (rules === null) return null;
  const out: BundleRule[] = [];
  for (const rule of rules) {
    const validated = validateRuleDefinition(rule.definition);
    if (!validated.ok) return null;
    out.push({ ...rule, definition: validated.definition });
  }
  return out;
}

export const PATCH = withAdmin(async (req, { uid, params }) => {
  const id = params.id;
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
    const fields = normalizeBundleFields(body.fields);
    if (!fields) return NextResponse.json({ error: "invalid fields" }, { status: 400 });
    values.push(JSON.stringify(fields));
    sets.push(`fields = $${values.length}::jsonb`);
  }
  if (body.rules !== undefined) {
    const rules = validatedRules(body.rules);
    if (!rules) return NextResponse.json({ error: "invalid rules" }, { status: 400 });
    values.push(JSON.stringify(rules));
    sets.push(`rules = $${values.length}::jsonb`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(id);
  const r = await db.query(
    `UPDATE bundles SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint RETURNING workspace_id`,
    values,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "bundle.update", {
    entity: "bundle",
    entityId: Number(id),
    workspaceId: Number(r.rows[0].workspace_id),
  });
  return NextResponse.json({ id: Number(id) });
});

export const DELETE = withAdmin(async (_req, { uid, params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM bundles WHERE id = $1::bigint RETURNING workspace_id", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "bundle.delete", {
    entity: "bundle",
    entityId: Number(id),
    workspaceId: Number(r.rows[0].workspace_id),
  });
  return NextResponse.json({ deleted: Number(id) });
});
