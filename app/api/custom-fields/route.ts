import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { requireProjectPermission } from "@/lib/api-project-auth";

const TYPES = new Set(["number", "text", "select"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(projectId), "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query(
    "SELECT id, name, field_type, options FROM custom_fields WHERE project_id = $1::bigint ORDER BY position, id",
    [projectId],
  );
  return NextResponse.json(r.rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { project_id, name, field_type, options } = body;
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!name || String(name).trim() === "" || !TYPES.has(field_type)) {
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
    [project_id, String(name).trim(), field_type, JSON.stringify(opts)],
  );
  await notifyProject(project_id);
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
