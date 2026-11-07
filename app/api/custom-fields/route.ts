import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { withProject } from "@/lib/api/route";

const TYPES = new Set(["number", "text", "select"]);

export const GET = withProject("view", async (_req, { projectId }) => {
  const r = await db.query(
    "SELECT id, name, field_type, options FROM custom_fields WHERE project_id = $1::bigint ORDER BY position, id",
    [projectId],
  );
  return NextResponse.json(r.rows);
});

export const POST = withProject("edit", async (_req, { projectId, body }) => {
  const { name, field_type, options } = (body ?? {}) as { name?: string; field_type?: string; options?: unknown };
  if (!name || String(name).trim() === "" || !field_type || !TYPES.has(field_type)) {
    return NextResponse.json(
      { error: "project_id, name and valid field_type (number|text|select) are required" },
      { status: 400 },
    );
  }
  const opts =
    field_type === "select"
      ? (Array.isArray(options) ? options : String(options ?? "").split(","))
          .map((o: unknown) => String(o).trim())
          .filter((o: string) => o !== "")
      : [];
  const r = await db.query(
    `INSERT INTO custom_fields (project_id, name, field_type, options, position)
     VALUES ($1::bigint, $2, $3, $4::jsonb,
       COALESCE((SELECT MAX(position) FROM custom_fields WHERE project_id = $1::bigint), 0) + 1000)
     RETURNING id`,
    [projectId, String(name).trim(), field_type, JSON.stringify(opts)],
  );
  await notifyProject(projectId);
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}, { body: true });
