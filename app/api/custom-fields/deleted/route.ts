import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { normalizeCustomFieldConfig } from "@/lib/custom-fields";

/** Fields that were soft-deleted from this project. */
export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    `SELECT id, name, field_type, options, description, config, deleted_at::text AS deleted_at
     FROM custom_fields
     WHERE project_id = $1::bigint AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC, id DESC`,
    [projectId],
  );
  return NextResponse.json(
    r.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      field_type: row.field_type,
      options: (row.options ?? []) as string[],
      description: row.description ?? "",
      config: normalizeCustomFieldConfig(row.config),
      deleted_at: row.deleted_at,
    })),
  );
});
