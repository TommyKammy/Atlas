import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { getProjectApps } from "@/lib/data";
import { appDefinition } from "@/lib/integrations";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const GET = withProject("view", async (_req, { projectId }) => {
  return NextResponse.json(await getProjectApps(projectId));
});

export const POST = withProject("edit", async (_req, { uid, projectId, body }) => {
  const payload = (body ?? {}) as { app_key?: unknown; config?: unknown };
  const appKey = typeof payload.app_key === "string" ? payload.app_key : "";
  const definition = appDefinition(appKey);
  if (!definition) return NextResponse.json({ error: "unknown app" }, { status: 400 });
  const rawConfig =
    typeof payload.config === "object" && payload.config !== null
      ? (payload.config as Record<string, unknown>)
      : {};
  const config: Record<string, string> = {};
  for (const field of definition.fields) {
    const raw = rawConfig[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && value === "") {
      return NextResponse.json({ error: `${field.label} is required` }, { status: 400 });
    }
    if (value) config[field.key] = value.slice(0, 500);
  }
  try {
    const r = await db.query(
      `INSERT INTO project_apps (project_id, app_key, config, created_by)
       VALUES ($1::bigint, $2, $3::jsonb, $4) RETURNING id`,
      [projectId, appKey, JSON.stringify(config), uid],
    );
    await notifyProject(projectId);
    await audit(uid, "project_app.install", {
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
}, { body: true });
