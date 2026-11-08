import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { getProjectAccess } from "@/lib/repositories/projects";
import { normalizeCustomFieldConfig } from "@/lib/custom-fields";

/** Workspace field library used by the "ライブラリから選択" flow. */
export const GET = withUser(async (req, { uid }) => {
  const projectId = Number(new URL(req.url).searchParams.get("project_id"));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  const access = await getProjectAccess(uid, projectId);
  if (!access.role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const project = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [projectId]);
  if (project.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = await db.query(
    `SELECT id, name, field_type, options, description, config
     FROM field_library WHERE workspace_id = $1::bigint ORDER BY name, id`,
    [Number(project.rows[0].workspace_id)],
  );
  return NextResponse.json(
    r.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      field_type: row.field_type,
      options: (row.options ?? []) as string[],
      description: row.description ?? "",
      config: normalizeCustomFieldConfig(row.config),
    })),
  );
});

export const POST = withUser(async (req, { uid }) => {
  const body = (await req.json().catch(() => null)) as {
    project_id?: unknown;
    name?: unknown;
    field_type?: unknown;
    options?: unknown;
    description?: unknown;
    config?: unknown;
  } | null;
  const projectId = Number(body?.project_id);
  if (!Number.isInteger(projectId) || projectId <= 0 || !body?.name || !body?.field_type) {
    return NextResponse.json({ error: "project_id, name and field_type are required" }, { status: 400 });
  }
  const access = await getProjectAccess(uid, projectId);
  if (access.role !== "admin" && access.role !== "editor") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const project = await db.query("SELECT workspace_id FROM projects WHERE id = $1::bigint", [projectId]);
  if (project.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const options = Array.isArray(body.options)
    ? body.options.map((item) => String(item).trim()).filter((item) => item !== "")
    : [];
  const r = await db.query(
    `INSERT INTO field_library (workspace_id, name, field_type, options, description, config, created_by)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5, $6::jsonb, $7::bigint)
     RETURNING id`,
    [
      Number(project.rows[0].workspace_id),
      String(body.name).trim().slice(0, 120),
      String(body.field_type),
      JSON.stringify(options),
      typeof body.description === "string" ? body.description.trim().slice(0, 500) : "",
      JSON.stringify(body.config && typeof body.config === "object" ? body.config : {}),
      uid,
    ],
  );
  return NextResponse.json({ id: Number(r.rows[0].id) }, { status: 201 });
});
