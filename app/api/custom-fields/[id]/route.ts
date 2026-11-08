import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyField } from "@/lib/notify";
import { withResourceProject } from "@/lib/api/route";
import {
  normalizeCustomFieldConfig,
  parseCustomFieldConfig,
  type CustomFieldType,
} from "@/lib/custom-fields";
import { validateCustomFieldReferences } from "@/lib/custom-field-validation";

export const PATCH = withResourceProject("edit", "custom_fields", async (_req, { uid, params, body }) => {
  const id = params.id;
  const payload = (body ?? {}) as {
    name?: unknown;
    options?: unknown;
    description?: unknown;
    config?: unknown;
    access_level?: unknown;
    editor_ids?: unknown;
  };
  const current = await db.query(
    "SELECT field_type, config, project_id FROM custom_fields WHERE id = $1::bigint AND deleted_at IS NULL",
    [id],
  );
  if (current.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const fieldType = current.rows[0].field_type as CustomFieldType;
  const projectId = Number(current.rows[0].project_id);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof payload.name === "string" && payload.name.trim() !== "") {
    values.push(payload.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (payload.description !== undefined) {
    values.push(typeof payload.description === "string" ? payload.description.trim().slice(0, 500) : "");
    sets.push(`description = $${values.length}`);
  }
  if (Array.isArray(payload.options) && (fieldType === "select" || fieldType === "multi_select")) {
    values.push(JSON.stringify(payload.options.map((o) => String(o).trim()).filter((o) => o !== "")));
    sets.push(`options = $${values.length}::jsonb`);
  }
  if (payload.config !== undefined) {
    const parsed = parseCustomFieldConfig(fieldType, payload.config);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const referenceError = await validateCustomFieldReferences(projectId, fieldType, parsed.config, uid);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });
    values.push(JSON.stringify(parsed.config));
    sets.push(`config = $${values.length}::jsonb`);
  }
  if (payload.access_level !== undefined) {
    const accessLevel = payload.access_level === "admins" || payload.access_level === "custom"
      ? payload.access_level
      : "everyone";
    values.push(accessLevel);
    sets.push(`access_level = $${values.length}`);
  }
  if (payload.editor_ids !== undefined) {
    const editorIds = Array.isArray(payload.editor_ids)
      ? [...new Set(payload.editor_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
      : [];
    values.push(JSON.stringify(editorIds));
    sets.push(`editor_ids = $${values.length}::jsonb`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "no changes supplied" }, { status: 400 });
  }
  values.push(id);
  const r = await db.query(
    `UPDATE custom_fields SET ${sets.join(", ")}
     WHERE id = $${values.length}::bigint AND deleted_at IS NULL
     RETURNING id, name, field_type, options, description, config, access_level, editor_ids`,
    values,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = r.rows[0];
  if (fieldType === "auto_id" && payload.config !== undefined) {
    const prefix = normalizeCustomFieldConfig(row.config).prefix ?? "ID-";
    await db.query(
      "UPDATE task_custom_values SET value_text = $2 || value_number::text WHERE field_id = $1::bigint AND value_number IS NOT NULL",
      [id, prefix],
    );
  }
  return NextResponse.json({
    id: Number(row.id),
    name: row.name,
    field_type: row.field_type,
    options: row.options ?? [],
    description: row.description ?? "",
    config: normalizeCustomFieldConfig(row.config),
    access_level: row.access_level ?? "everyone",
    editor_ids: Array.isArray(row.editor_ids) ? row.editor_ids.map(Number) : [],
  });
}, { body: true });

export const DELETE = withResourceProject("edit", "custom_fields", async (_req, { params }) => {
  const id = params.id;
  const r = await db.query(
    "UPDATE custom_fields SET deleted_at = COALESCE(deleted_at, now()) WHERE id = $1::bigint RETURNING id",
    [id],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyField(id);
  return NextResponse.json({ deleted: Number(id), soft: true });
});
