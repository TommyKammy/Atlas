import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { ensureAutoIdValues } from "@/lib/auto-id";
import { withProject } from "@/lib/api/route";
import {
  normalizeCustomFieldConfig,
  parseCustomFieldConfig,
  type CustomFieldType,
} from "@/lib/custom-fields";

const TYPES = new Set<CustomFieldType>([
  "number",
  "text",
  "select",
  "multi_select",
  "date",
  "people",
  "auto_id",
  "project",
  "completed_on",
  "created_at",
  "modified_at",
  "created_by",
  "collaborators",
  "attachments",
  "blocked_by",
  "blocking",
  "formula",
  "reference",
  "lookup",
  "rollup",
  "timer",
  "time_tracking",
]);

export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    `SELECT id, name, field_type, options, description, config, access_level, editor_ids
     FROM custom_fields WHERE project_id = $1::bigint AND deleted_at IS NULL ORDER BY position, id`,
    [projectId],
  );
  return NextResponse.json(
    r.rows.map((row) => ({
      ...row,
      options: (row.options ?? []) as string[],
      config: normalizeCustomFieldConfig(row.config),
      access_level: row.access_level ?? "everyone",
      editor_ids: Array.isArray(row.editor_ids) ? row.editor_ids.map(Number) : [],
    })),
  );
});

export const POST = withProject("edit", async (_req, { projectId, body }) => {
  const { name, field_type, options, description, config, access_level, editor_ids } = (body ?? {}) as {
    name?: string;
    field_type?: string;
    options?: unknown;
    description?: unknown;
    config?: unknown;
    access_level?: unknown;
    editor_ids?: unknown;
  };
  if (!name || String(name).trim() === "" || !field_type || !TYPES.has(field_type as CustomFieldType)) {
    return NextResponse.json(
      { error: "project_id, name and valid field_type is required" },
      { status: 400 },
    );
  }
  const type = field_type as CustomFieldType;
  const parsedConfig = parseCustomFieldConfig(type, config);
  if (!parsedConfig.ok) return NextResponse.json({ error: parsedConfig.error }, { status: 400 });
  const opts =
    type === "select" || type === "multi_select"
      ? (Array.isArray(options) ? options : String(options ?? "").split(","))
          .map((o: unknown) => String(o).trim())
          .filter((o: string) => o !== "")
      : [];
  const descriptionValue = typeof description === "string" ? description.trim().slice(0, 500) : "";
  const accessLevel = access_level === "admins" || access_level === "custom" ? access_level : "everyone";
  const editorIds = Array.isArray(editor_ids)
    ? [...new Set(editor_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  const r = await db.query(
    `INSERT INTO custom_fields
       (project_id, name, field_type, options, description, config, access_level, editor_ids, position)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8::jsonb,
       COALESCE((SELECT MAX(position) FROM custom_fields WHERE project_id = $1::bigint AND deleted_at IS NULL), 0) + 1000)
     RETURNING id`,
    [
      projectId,
      String(name).trim(),
      type,
      JSON.stringify(opts),
      descriptionValue,
      JSON.stringify(parsedConfig.config),
      accessLevel,
      JSON.stringify(editorIds),
    ],
  );
  if (type === "auto_id") await ensureAutoIdValues(projectId);
  await notifyProject(projectId);
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
