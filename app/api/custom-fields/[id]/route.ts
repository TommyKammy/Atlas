import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyField } from "@/lib/notify";
import { withResourceProject } from "@/lib/api/route";
import {
  normalizeCustomFieldConfig,
  parseCustomFieldConfig,
  type CustomFieldType,
} from "@/lib/custom-fields";

export const PATCH = withResourceProject("edit", "custom_fields", async (_req, { params, body }) => {
  const id = params.id;
  const payload = (body ?? {}) as { name?: unknown; options?: unknown; description?: unknown; config?: unknown };
  const current = await db.query(
    "SELECT field_type, config FROM custom_fields WHERE id = $1::bigint",
    [id],
  );
  if (current.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const fieldType = current.rows[0].field_type as CustomFieldType;
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
  if (Array.isArray(payload.options) && fieldType === "select") {
    values.push(JSON.stringify(payload.options.map((o) => String(o).trim()).filter((o) => o !== "")));
    sets.push(`options = $${values.length}::jsonb`);
  }
  if (payload.config !== undefined) {
    const parsed = parseCustomFieldConfig(fieldType, payload.config);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    values.push(JSON.stringify(parsed.config));
    sets.push(`config = $${values.length}::jsonb`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "name, description, options or config required" }, { status: 400 });
  }
  values.push(id);
  const r = await db.query(
    `UPDATE custom_fields SET ${sets.join(", ")} WHERE id = $${values.length}::bigint
     RETURNING id, name, field_type, options, description, config`,
    values,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = r.rows[0];
  return NextResponse.json({
    id: Number(row.id),
    name: row.name,
    field_type: row.field_type,
    options: row.options ?? [],
    description: row.description ?? "",
    config: normalizeCustomFieldConfig(row.config),
  });
}, { body: true });

export const DELETE = withResourceProject("edit", "custom_fields", async (_req, { params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM custom_fields WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyField(id);
  return NextResponse.json({ deleted: Number(id) });
});
