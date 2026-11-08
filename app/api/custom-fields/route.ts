import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";
import {
  normalizeCustomFieldConfig,
  parseCustomFieldConfig,
  type CustomFieldType,
} from "@/lib/custom-fields";

const TYPES = new Set<CustomFieldType>(["number", "text", "select", "multi_select", "date"]);

export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    `SELECT id, name, field_type, options, description, config
     FROM custom_fields WHERE project_id = $1::bigint ORDER BY position, id`,
    [projectId],
  );
  return NextResponse.json(
    r.rows.map((row) => ({
      ...row,
      options: (row.options ?? []) as string[],
      config: normalizeCustomFieldConfig(row.config),
    })),
  );
});

export const POST = withProject("edit", async (_req, { projectId, body }) => {
  const { name, field_type, options, description, config } = (body ?? {}) as {
    name?: string;
    field_type?: string;
    options?: unknown;
    description?: unknown;
    config?: unknown;
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
  const r = await db.query(
    `INSERT INTO custom_fields (project_id, name, field_type, options, description, config, position)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5, $6::jsonb,
       COALESCE((SELECT MAX(position) FROM custom_fields WHERE project_id = $1::bigint), 0) + 1000)
     RETURNING id`,
    [
      projectId,
      String(name).trim(),
      type,
      JSON.stringify(opts),
      descriptionValue,
      JSON.stringify(parsedConfig.config),
    ],
  );
  await notifyProject(projectId);
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
