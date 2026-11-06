import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { getProjectApps } from "@/lib/data";
import { appDefinition } from "@/lib/integrations";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = Number(id);
  const auth = await requireProjectPermission(req, projectId, "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await getProjectApps(projectId));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = Number(id);
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const appKey = typeof body?.app_key === "string" ? body.app_key : "";
  const definition = appDefinition(appKey);
  if (!definition) return NextResponse.json({ error: "unknown app" }, { status: 400 });
  const rawConfig = typeof body?.config === "object" && body.config !== null ? body.config : {};
  const config: Record<string, string> = {};
  for (const field of definition.fields) {
    const value = typeof rawConfig[field.key] === "string" ? rawConfig[field.key].trim() : "";
    if (field.required && value === "") {
      return NextResponse.json({ error: `${field.label} is required` }, { status: 400 });
    }
    if (value) config[field.key] = value.slice(0, 500);
  }
  try {
    const r = await db.query(
      `INSERT INTO project_apps (project_id, app_key, config, created_by)
       VALUES ($1::bigint, $2, $3::jsonb, $4) RETURNING id`,
      [projectId, appKey, JSON.stringify(config), getCurrentUserIdFromRequest(req)],
    );
    await notifyProject(projectId);
    await audit(getCurrentUserIdFromRequest(req), "project_app.install", {
      entity: "project_app",
      entityId: r.rows[0].id,
      projectId,
    });
    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "app is already installed" }, { status: 409 });
    }
    throw error;
  }
}
