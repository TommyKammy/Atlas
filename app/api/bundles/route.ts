import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { withAdmin } from "@/lib/api/route";
import { getBundlesForProject } from "@/lib/data";
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

export const GET = withProject("view", async (_req, { projectId }) => {
  return NextResponse.json(await getBundlesForProject(projectId));
});

export const POST = withAdmin(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const workspaceId = Number(body?.workspace_id);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const fields = normalizeBundleFields(body?.fields);
  const rules = validatedRules(body?.rules);
  if (!Number.isInteger(workspaceId) || workspaceId <= 0 || name === "" || !fields || !rules) {
    return NextResponse.json(
      { error: "workspace_id, name, valid fields and valid rules are required" },
      { status: 400 },
    );
  }
  const r = await db.query(
    `INSERT INTO bundles (workspace_id, name, description, fields, rules, created_by)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5::jsonb, $6) RETURNING id`,
    [
      workspaceId,
      name,
      String(body?.description ?? "").trim(),
      JSON.stringify(fields),
      JSON.stringify(rules),
      uid,
    ],
  );
  await audit(uid, "bundle.create", {
    entity: "bundle",
    entityId: r.rows[0].id,
    workspaceId,
  });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
});
