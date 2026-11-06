import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { getProjectForms } from "@/lib/data";
import { normalizeFormFields } from "@/lib/forms";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(projectId), "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await getProjectForms(Number(projectId)));
}

export async function POST(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const { project_id, name, description, fields } = body ?? {};
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const normalized = normalizeFormFields(fields);
  if (!name || String(name).trim() === "" || !normalized) {
    return NextResponse.json({ error: "name and valid fields are required" }, { status: 400 });
  }
  const r = await db.query(
    `INSERT INTO project_forms (project_id, name, description, fields, created_by)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5) RETURNING id`,
    [
      project_id,
      String(name).trim(),
      String(description ?? "").trim(),
      JSON.stringify(normalized),
      uid,
    ],
  );
  await notifyProject(Number(project_id));
  await audit(uid, "form.create", {
    entity: "form",
    entityId: r.rows[0].id,
    projectId: Number(project_id),
  });
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
