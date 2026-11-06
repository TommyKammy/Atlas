import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

async function owner(req: Request, projectId: number, appId: string) {
  const auth = await requireProjectPermission(req, projectId, "edit");
  if (!auth.ok) return { ok: false as const, response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  const row = await db.query(
    "SELECT id FROM project_apps WHERE id = $1::bigint AND project_id = $2::bigint",
    [appId, projectId],
  );
  if (row.rowCount === 0) {
    return { ok: false as const, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { ok: true as const };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; appId: string }> },
) {
  const { id, appId } = await params;
  const projectId = Number(id);
  const checked = await owner(req, projectId, appId);
  if (!checked.ok) return checked.response;
  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.enabled === "boolean") {
    values.push(body.enabled);
    sets.push(`enabled = $${values.length}`);
  }
  if (typeof body.config === "object" && body.config !== null) {
    values.push(JSON.stringify(body.config));
    sets.push(`config = $${values.length}::jsonb`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(appId);
  await db.query(
    `UPDATE project_apps SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "project_app.update", {
    entity: "project_app",
    entityId: Number(appId),
    projectId,
  });
  return NextResponse.json({ id: Number(appId) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; appId: string }> },
) {
  const { id, appId } = await params;
  const projectId = Number(id);
  const checked = await owner(req, projectId, appId);
  if (!checked.ok) return checked.response;
  await db.query("DELETE FROM project_apps WHERE id = $1::bigint", [appId]);
  await notifyProject(projectId);
  await audit(getCurrentUserIdFromRequest(req), "project_app.remove", {
    entity: "project_app",
    entityId: Number(appId),
    projectId,
  });
  return NextResponse.json({ deleted: Number(appId) });
}
